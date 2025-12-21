import os
import json
import folder_paths
import server
from aiohttp import web
import urllib.parse
from PIL import Image, ImageOps
import numpy as np
import torch
import hashlib
import time
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
import threading
import io

NODE_DIR = os.path.dirname(os.path.abspath(__file__))
UI_STATE_FILE = os.path.join(NODE_DIR, "image_gallery_ui_state.json")
CACHE_DIR = os.path.join(NODE_DIR, "thumbnail_cache")
IMAGE_EXTENSIONS = frozenset(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff'])

WEB_DIRECTORY = "./js"

# Ensure cache directory exists
os.makedirs(CACHE_DIR, exist_ok=True)

# Thread pool for background operations
_executor = ThreadPoolExecutor(max_workers=4)

# === CACHING LAYER ===

class ImageCache:
    """Thread-safe cache for image metadata and directory listings."""
    
    def __init__(self, ttl=30):  # 30 second TTL
        self._cache = {}
        self._lock = threading.RLock()
        self._ttl = ttl
        self._metadata_cache = {}  # Separate cache for metadata (longer TTL)
        self._metadata_ttl = 300   # 5 minute TTL for metadata
    
    def _is_expired(self, entry, ttl):
        return time.time() - entry['time'] > ttl
    
    def get_directory_listing(self, input_dir):
        """Get cached directory listing or refresh if expired."""
        cache_key = f"dir:{input_dir}"
        
        with self._lock:
            if cache_key in self._cache:
                entry = self._cache[cache_key]
                if not self._is_expired(entry, self._ttl):
                    return entry['data']
        
        # Refresh cache
        images, folders, mtimes = self._scan_directory(input_dir)
        
        with self._lock:
            self._cache[cache_key] = {
                'time': time.time(),
                'data': (images, folders, mtimes)
            }
        
        return images, folders, mtimes
    
    def _scan_directory(self, input_dir):
        """Scan directory and return images, folders, and modification times."""
        images = []
        folders = set()
        mtimes = {}
        
        if not os.path.exists(input_dir):
            return images, [], mtimes
        
        for root, dirs, files in os.walk(input_dir):
            rel_root = os.path.relpath(root, input_dir)
            if rel_root != ".":
                folders.add(rel_root)
            
            for filename in files:
                ext = os.path.splitext(filename)[1].lower()
                if ext in IMAGE_EXTENSIONS:
                    if rel_root == ".":
                        rel_path = filename
                    else:
                        rel_path = os.path.join(rel_root, filename)
                    
                    full_path = os.path.join(root, filename)
                    try:
                        mtimes[rel_path] = os.path.getmtime(full_path)
                    except OSError:
                        mtimes[rel_path] = 0
                    
                    images.append(rel_path)
        
        return sorted(images, key=lambda x: x.lower()), sorted(list(folders), key=lambda x: x.lower()), mtimes
    
    def get_metadata_status(self, image_path, mtime):
        """Get cached metadata status for an image."""
        cache_key = f"meta:{image_path}:{mtime}"
        
        with self._lock:
            if cache_key in self._metadata_cache:
                entry = self._metadata_cache[cache_key]
                if not self._is_expired(entry, self._metadata_ttl):
                    return entry['data']
        
        return None
    
    def set_metadata_status(self, image_path, mtime, has_metadata):
        """Cache metadata status for an image."""
        cache_key = f"meta:{image_path}:{mtime}"
        
        with self._lock:
            self._metadata_cache[cache_key] = {
                'time': time.time(),
                'data': has_metadata
            }
    
    def invalidate(self):
        """Clear all caches."""
        with self._lock:
            self._cache.clear()
            # Keep metadata cache as it's based on mtime

_image_cache = ImageCache()


# === OPTIMIZED FUNCTIONS ===

def load_json_file(file_path, default_data={}):
    if not os.path.exists(file_path):
        return default_data
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            if not content:
                return default_data
            return json.loads(content)
    except Exception as e:
        print(f"Error loading {file_path}: {e}")
        return default_data

def save_json_file(data, file_path):
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving {file_path}: {e}")

load_ui_state = lambda: load_json_file(UI_STATE_FILE)
save_ui_state = lambda data: save_json_file(data, UI_STATE_FILE)


def has_comfyui_metadata_fast(image_path, mtime=None):
    """
    Check if a PNG file has ComfyUI metadata with caching.
    """
    if not image_path.lower().endswith('.png'):
        return False
    
    if mtime is None:
        try:
            mtime = os.path.getmtime(image_path)
        except OSError:
            mtime = 0
    
    # Check cache first
    cached = _image_cache.get_metadata_status(image_path, mtime)
    if cached is not None:
        return cached
    
    # Read metadata from file
    try:
        with open(image_path, 'rb') as f:
            # Read PNG signature + IHDR
            header = f.read(33)
            if len(header) < 8 or header[:8] != b'\x89PNG\r\n\x1a\n':
                _image_cache.set_metadata_status(image_path, mtime, False)
                return False
            
            # Scan for tEXt chunks containing 'prompt' or 'workflow'
            f.seek(8)  # Skip signature
            has_meta = False
            
            while True:
                chunk_header = f.read(8)
                if len(chunk_header) < 8:
                    break
                
                length = int.from_bytes(chunk_header[:4], 'big')
                chunk_type = chunk_header[4:8]
                
                if chunk_type in (b'tEXt', b'iTXt'):
                    # Read chunk data to check for keywords
                    chunk_data = f.read(min(length, 1024))  # Read up to 1KB
                    if b'prompt' in chunk_data or b'workflow' in chunk_data:
                        has_meta = True
                        break
                    f.seek(length - len(chunk_data) + 4, 1)  # Skip rest + CRC
                elif chunk_type == b'IEND':
                    break
                else:
                    f.seek(length + 4, 1)  # Skip chunk data + CRC
            
            _image_cache.set_metadata_status(image_path, mtime, has_meta)
            return has_meta
            
    except Exception:
        _image_cache.set_metadata_status(image_path, mtime, False)
        return False


def get_input_images_optimized(subfolder="", metadata_filter="all", sort_by="name"):
    """Optimized image listing with caching."""
    input_dir = folder_paths.get_input_directory()
    
    # Get cached directory listing
    all_images, all_folders, mtimes = _image_cache.get_directory_listing(input_dir)
    
    # Filter by subfolder
    if subfolder:
        if subfolder == ".":
            all_images = [img for img in all_images if os.sep not in img and "/" not in img]
        else:
            all_images = [img for img in all_images if img.startswith(subfolder + os.sep) or img.startswith(subfolder + "/")]
    
    # Apply metadata filter (only if needed)
    if metadata_filter != "all":
        filtered_images = []
        for img in all_images:
            full_path = os.path.join(input_dir, img)
            mtime = mtimes.get(img, 0)
            has_meta = has_comfyui_metadata_fast(full_path, mtime)
            
            if metadata_filter == "with" and has_meta:
                filtered_images.append(img)
            elif metadata_filter == "without" and not has_meta:
                filtered_images.append(img)
        
        all_images = filtered_images
    
    # Apply sorting
    if sort_by == "date":
        # Sort by modification time, newest first
        all_images = sorted(all_images, key=lambda x: mtimes.get(x, 0), reverse=True)
    elif sort_by == "date_asc":
        # Sort by modification time, oldest first
        all_images = sorted(all_images, key=lambda x: mtimes.get(x, 0))
    else:
        # Default: sort by name (already sorted from cache, but ensure it)
        all_images = sorted(all_images, key=lambda x: x.lower())
    
    return all_images, all_folders, mtimes


def get_thumbnail_path(image_path):
    """Get path to cached thumbnail."""
    # Create hash of path + mtime for cache key
    try:
        mtime = os.path.getmtime(image_path)
    except OSError:
        mtime = 0
    
    cache_key = hashlib.md5(f"{image_path}:{mtime}".encode()).hexdigest()
    return os.path.join(CACHE_DIR, f"{cache_key}.webp")


def generate_thumbnail(image_path, max_size=200):
    """Generate and cache a thumbnail."""
    thumb_path = get_thumbnail_path(image_path)
    
    # Return cached thumbnail if exists
    if os.path.exists(thumb_path):
        return thumb_path
    
    try:
        with Image.open(image_path) as img:
            img = ImageOps.exif_transpose(img)
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
            
            # Convert to RGB if necessary
            if img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (30, 30, 30))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            
            img.save(thumb_path, 'WEBP', quality=80)
            return thumb_path
    except Exception as e:
        print(f"Error generating thumbnail for {image_path}: {e}")
        return None


# === API ENDPOINTS ===

@server.PromptServer.instance.routes.get("/imagegallery/get_images")
async def get_images_endpoint(request):
    try:
        page = int(request.query.get('page', 1))
        per_page = int(request.query.get('per_page', 50))
        search = request.query.get('search', '').lower()
        folder = request.query.get('folder', '')
        metadata_filter = request.query.get('metadata', 'all')
        sort_by = request.query.get('sort', 'name')  # NEW: sort parameter
        
        if metadata_filter not in ['all', 'with', 'without']:
            metadata_filter = 'all'
        
        if sort_by not in ['name', 'date', 'date_asc']:
            sort_by = 'name'
        
        all_images, all_folders, mtimes = get_input_images_optimized(folder, metadata_filter, sort_by)
        
        # Filter by search term
        if search:
            all_images = [img for img in all_images if search in img.lower()]
        
        total_images = len(all_images)
        total_pages = max(1, (total_images + per_page - 1) // per_page)
        
        start_index = (page - 1) * per_page
        end_index = start_index + per_page
        paginated_images = all_images[start_index:end_index]
        
        image_info_list = []
        for img_name in paginated_images:
            encoded_name = urllib.parse.quote(img_name, safe='')
            image_info_list.append({
                "name": img_name,
                "preview_url": f"/imagegallery/thumb?filename={encoded_name}"
            })
        
        return web.json_response({
            "images": image_info_list,
            "folders": all_folders,
            "total_pages": total_pages,
            "current_page": page
        })
    except Exception as e:
        import traceback
        print(f"Error in get_images_endpoint: {traceback.format_exc()}")
        return web.json_response({"error": str(e)}, status=500)


@server.PromptServer.instance.routes.get("/imagegallery/thumb")
async def get_thumbnail(request):
    """Serve optimized thumbnails instead of full images."""
    filename = request.query.get('filename')
    
    if not filename:
        return web.Response(status=400, text="Missing filename parameter")
    
    try:
        filename_decoded = urllib.parse.unquote(filename)
        
        if ".." in filename_decoded:
            return web.Response(status=403, text="Invalid filename")
        
        input_dir = folder_paths.get_input_directory()
        image_path = os.path.normpath(os.path.join(input_dir, filename_decoded))
        
        if not image_path.startswith(os.path.normpath(input_dir)):
            return web.Response(status=403, text="Access denied")
        
        if not os.path.exists(image_path):
            return web.Response(status=404, text="Image not found")
        
        # Generate or get cached thumbnail
        thumb_path = generate_thumbnail(image_path)
        
        if thumb_path and os.path.exists(thumb_path):
            return web.FileResponse(thumb_path, headers={
                'Cache-Control': 'public, max-age=86400',  # Cache for 24 hours
                'Content-Type': 'image/webp'
            })
        else:
            # Fallback to original image
            return web.FileResponse(image_path)
            
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@server.PromptServer.instance.routes.get("/imagegallery/preview")
async def get_preview_image(request):
    """Full image preview (for when user needs full resolution)."""
    filename = request.query.get('filename')
    
    if not filename:
        return web.Response(status=400, text="Missing filename parameter")
    
    try:
        filename_decoded = urllib.parse.unquote(filename)
        
        if ".." in filename_decoded:
            return web.Response(status=403, text="Invalid filename")
        
        input_dir = folder_paths.get_input_directory()
        image_path = os.path.normpath(os.path.join(input_dir, filename_decoded))
        
        if not image_path.startswith(os.path.normpath(input_dir)):
            return web.Response(status=403, text="Access denied")
        
        if os.path.exists(image_path) and os.path.isfile(image_path):
            return web.FileResponse(image_path, headers={
                'Cache-Control': 'public, max-age=3600'
            })
        else:
            return web.Response(status=404, text=f"Image '{filename_decoded}' not found.")
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@server.PromptServer.instance.routes.post("/imagegallery/invalidate_cache")
async def invalidate_cache(request):
    """Endpoint to manually invalidate cache (called on refresh)."""
    _image_cache.invalidate()
    return web.json_response({"status": "ok"})


@server.PromptServer.instance.routes.post("/imagegallery/set_ui_state")
async def set_ui_state(request):
    try:
        data = await request.json()
        node_id = str(data.get("node_id"))
        gallery_id = data.get("gallery_id")
        state = data.get("state", {})

        if not gallery_id:
            return web.Response(status=400)

        node_key = f"{gallery_id}_{node_id}"
        ui_states = load_ui_state()
        if node_key not in ui_states:
            ui_states[node_key] = {}
        ui_states[node_key].update(state)
        save_ui_state(ui_states)
        return web.json_response({"status": "ok"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


@server.PromptServer.instance.routes.get("/imagegallery/get_ui_state")
async def get_ui_state(request):
    try:
        node_id = request.query.get('node_id')
        gallery_id = request.query.get('gallery_id')

        if not node_id or not gallery_id:
            return web.json_response({"error": "node_id or gallery_id is required"}, status=400)

        node_key = f"{gallery_id}_{node_id}"
        ui_states = load_ui_state()
        node_state = ui_states.get(node_key, {"is_collapsed": False, "selected_image": "", "metadata_filter": "all"})
        return web.json_response(node_state)
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


class LocalImageGallery:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "selected_image": ("STRING", {"default": ""})
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("IMAGE",)
    FUNCTION = "load_image"
    CATEGORY = "🖼️ Image Gallery"

    @classmethod
    def IS_CHANGED(cls, selected_image="", **kwargs):
        return selected_image
    
    @classmethod
    def VALIDATE_INPUTS(cls, selected_image="", **kwargs):
        if not selected_image:
            return True
        
        input_dir = folder_paths.get_input_directory()
        image_path = os.path.normpath(os.path.join(input_dir, selected_image))
        
        if not image_path.startswith(os.path.normpath(input_dir)):
            return f"Invalid image path: {selected_image}"
        
        if not os.path.exists(image_path):
            return f"Image not found: {selected_image}"
        
        return True

    def load_image(self, unique_id, selected_image="", **kwargs):
        if not selected_image:
            print("LocalImageGallery: No image selected, returning blank image.")
            blank = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return (blank,)
        
        input_dir = folder_paths.get_input_directory()
        image_path = os.path.normpath(os.path.join(input_dir, selected_image))
        
        if not image_path.startswith(os.path.normpath(input_dir)):
            print(f"LocalImageGallery: Invalid path attempted: {image_path}")
            blank = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return (blank,)
        
        if not os.path.exists(image_path):
            print(f"LocalImageGallery: Image not found: {image_path}")
            blank = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return (blank,)
        
        try:
            img = Image.open(image_path)
            img = ImageOps.exif_transpose(img)
            
            if img.mode == 'I':
                img = img.point(lambda i: i * (1 / 255))
            
            img = img.convert("RGB")
            
            img_array = np.array(img).astype(np.float32) / 255.0
            img_tensor = torch.from_numpy(img_array).unsqueeze(0)
            
            return (img_tensor,)
            
        except Exception as e:
            print(f"LocalImageGallery: Error loading image '{selected_image}': {e}")
            import traceback
            traceback.print_exc()
            blank = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return (blank,)


NODE_CLASS_MAPPINGS = {
    "LocalImageGallery": LocalImageGallery
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LocalImageGallery": "Image Gallery Loader"
}

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']