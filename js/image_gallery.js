// image_gallery.js

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { folderManager } from "./folder_manager.js"; 

const LocalImageGalleryNode = {
    name: "LocalImageGallery",
    
    _pendingStateUpdates: new Map(),
    
    async setUiState(nodeId, galleryId, state) {
        const key = `${nodeId}-${galleryId}`;
        
        if (this._pendingStateUpdates.has(key)) {
            clearTimeout(this._pendingStateUpdates.get(key).timeout);
            state = { ...this._pendingStateUpdates.get(key).state, ...state };
        }
        
        const timeout = setTimeout(async () => {
            this._pendingStateUpdates.delete(key);
            try {
                await api.fetchApi("/imagegallery/set_ui_state", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ node_id: nodeId, gallery_id: galleryId, state }),
                });
            } catch(e) {
                console.error("LocalImageGallery: Failed to set UI state", e);
            }
        }, 1000);
        
        this._pendingStateUpdates.set(key, { timeout, state });
    },

    setup(nodeType, nodeData) {
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);

            this._gallery = {
                isLoading: false,
                currentPage: 1,
                totalPages: 1,
                availableImages: [],
                availableFolders: [],
                selectedImage: "",
                selectedImageSource: "", 
                selectedOriginalName: "",  
                currentFolder: "",
                currentSourceFolder: "",   
                availableSourceFolders: [], 
                metadataFilter: "all",
                sortOrder: "name",
                previewSize: 110,
                foldersRendered: false,
                elements: {},
                cachedHeights: { controls: 0, selectedDisplay: 0 },
                visibleRange: { start: 0, end: 0 },
                cardHeight: 140,
                columnsCount: 4,
            };

            if (!this.properties) this.properties = {};
            if (!this.properties.image_gallery_unique_id) {
                this.properties.image_gallery_unique_id = "image-gallery-" + Math.random().toString(36).substring(2, 11);
            }

            const HEADER_HEIGHT = 80;
            const MIN_NODE_WIDTH = 450;
            const MIN_GALLERY_HEIGHT = 200;

            this.size = [550, 480];

            const node = this;
            const state = this._gallery;

            // Hidden widgets
            const galleryIdWidget = this.addWidget("hidden_text", "image_gallery_unique_id_widget", 
                this.properties.image_gallery_unique_id, () => {}, {});
            galleryIdWidget.serializeValue = () => this.properties.image_gallery_unique_id;
            galleryIdWidget.draw = () => {};
            galleryIdWidget.computeSize = () => [0, 0];

            const selectionWidget = this.addWidget("hidden_text", "selected_image",
                this.properties.selected_image || "", () => {}, { multiline: false });
            selectionWidget.serializeValue = () => node.properties["selected_image"] || "";
            selectionWidget.draw = () => {};
            selectionWidget.computeSize = () => [0, 0];

            const sourceFolderWidget = this.addWidget("hidden_text", "source_folder",
                this.properties.source_folder || "", () => {}, { multiline: false });
            sourceFolderWidget.serializeValue = () => node.properties["source_folder"] || "";
            sourceFolderWidget.draw = () => {};
            sourceFolderWidget.computeSize = () => [0, 0];

            // Create container
            const widgetContainer = document.createElement("div");
            widgetContainer.className = "localimage-container-wrapper";
            widgetContainer.dataset.captureWheel = "true";
            widgetContainer.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

            this.addDOMWidget("gallery", "div", widgetContainer, {});

            const uniqueId = `localimage-gallery-${this.id}`;
            
            this._ensureGlobalStyles();
            
            widgetContainer.innerHTML = `
                <div id="${uniqueId}" class="localimage-root" style="height: 100%;">
                    <div class="localimage-container">
                        <div class="localimage-selected-display">
                            <span class="label">Selected:</span>
                            <span class="selected-name" title="">None</span>
                        </div>
                        <div class="localimage-controls">
                            <input type="text" class="search-input" placeholder="🔍 Search images...">
                            <select class="source-folder-select" title="Source folder">
                                <option value="">Loading...</option>
                            </select>
                            <select class="metadata-filter-select" title="Filter by metadata">
                                <option value="all">All</option>
                                <option value="with">With metadata</option>
                                <option value="without">Without metadata</option>
                            </select>
                            <select class="sort-order-select" title="Sort order">
                                <option value="name">Name (A-Z)</option>
                                <option value="date">Date (Newest)</option>
                                <option value="date_asc">Date (Oldest)</option>
                            </select>
                            <button class="refresh-btn" title="Refresh image list">🔄</button>
                        </div>
                        <div class="localimage-size-control">
                            <span class="size-label size-label-small">🖼️</span>
                            <input type="range" class="size-slider" min="50" max="400" value="110" title="Preview size">
                            <span class="size-label size-label-large">🖼️</span>
                            <button class="load-image-btn" title="Load image from computer">📂 Load Image</button>
                            <button class="folder-manager-btn" title="Manage source folders">📁 Folder Manager</button>
                            <input type="file" class="file-input-hidden" accept="image/*" multiple style="display: none;">
                        </div>
                        <div class="localimage-gallery">
                            <div class="localimage-gallery-viewport"></div>
                        </div>
                    </div>
                </div>
            `;
            
            // Cache all DOM elements once
            const els = state.elements;
            els.root = widgetContainer.querySelector(`#${uniqueId}`);
            els.container = widgetContainer;
            els.mainContainer = widgetContainer.querySelector(".localimage-container");
            els.gallery = widgetContainer.querySelector(".localimage-gallery");
            els.viewport = widgetContainer.querySelector(".localimage-gallery-viewport");
            els.searchInput = widgetContainer.querySelector(".search-input");
            els.selectedName = widgetContainer.querySelector(".selected-name");
            els.refreshBtn = widgetContainer.querySelector(".refresh-btn");
            els.metadataSelect = widgetContainer.querySelector(".metadata-filter-select");
            els.sortSelect = widgetContainer.querySelector(".sort-order-select");
            els.selectedDisplay = widgetContainer.querySelector(".localimage-selected-display");
            els.controls = widgetContainer.querySelector(".localimage-controls");
            els.sizeSlider = widgetContainer.querySelector(".size-slider");
            els.sizeControl = widgetContainer.querySelector(".localimage-size-control");
            els.loadImageBtn = widgetContainer.querySelector(".load-image-btn");
            els.fileInput = widgetContainer.querySelector(".file-input-hidden");
            els.sourceSelect = widgetContainer.querySelector(".source-folder-select");
            els.folderManagerBtn = widgetContainer.querySelector(".folder-manager-btn");

            const cacheHeights = () => {
                if (els.controls) state.cachedHeights.controls = els.controls.offsetHeight;
                if (els.selectedDisplay) state.cachedHeights.selectedDisplay = els.selectedDisplay.offsetHeight;
            };

            // === API FUNCTIONS ===
            const getImages = async (page = 1, search = "", metadataFilter = "all", sortOrder = "name") => {
                state.isLoading = true;
                try {
                    const sourceEncoded = encodeURIComponent(state.currentSourceFolder || '');
                    const url = `/imagegallery/get_images?page=${page}&per_page=100&search=${encodeURIComponent(search)}&metadata=${encodeURIComponent(metadataFilter)}&sort=${encodeURIComponent(sortOrder)}&source=${sourceEncoded}`;
                    const response = await api.fetchApi(url);
                    const data = await response.json();
                    state.totalPages = data.total_pages || 1;
                    state.currentPage = data.current_page || 1;
                    return data;
                } catch (error) {
                    console.error("LocalImageGallery: Error fetching images:", error);
                    return { images: [], folders: [], total_pages: 1, current_page: 1 };
                } finally {
                    state.isLoading = false;
                }
            };

            const updateSelection = () => {
                node.setProperty("selected_image", state.selectedImage);
                node.setProperty("source_folder", state.currentSourceFolder);
                node.setProperty("actual_source", state.selectedImageSource || "");  // Store actual source
                
                const widget = node.widgets.find(w => w.name === "selected_image");
                if (widget) widget.value = state.selectedImage;
                
                const sourceWidget = node.widgets.find(w => w.name === "source_folder");
                if (sourceWidget) sourceWidget.value = state.selectedImageSource || state.currentSourceFolder;

                // Update display name
                let displayName = "None";
                if (state.selectedImage) {
                    displayName = state.selectedImage;
                }
                els.selectedName.textContent = displayName;
                els.selectedName.title = displayName;

                // Update selected class on visible cards
                els.viewport.querySelectorAll('.localimage-image-card').forEach(card => {
                    card.classList.toggle('selected', card.dataset.imageName === state.selectedImage);
                });

                LocalImageGalleryNode.setUiState(node.id, node.properties.image_gallery_unique_id, { 
                    selected_image: state.selectedImage,
                    current_source_folder: state.currentSourceFolder,
                    selected_image_source: state.selectedImageSource,
                    metadata_filter: state.metadataFilter,
                    sort_order: state.sortOrder,
                    preview_size: state.previewSize
                });
            };

            const renderFolders = (folders) => {
                const currentVal = els.folderSelect.value;
                els.folderSelect.innerHTML = `<option value="">All Folders</option><option value=".">Root Only</option>`;
                
                const fragment = document.createDocumentFragment();
                folders.forEach(folder => {
                    const option = document.createElement('option');
                    option.value = folder;
                    option.textContent = folder.replace(/\\/g, '/');
                    fragment.appendChild(option);
                });
                els.folderSelect.appendChild(fragment);
                els.folderSelect.value = currentVal;
            };

            const loadSourceFolders = async () => {
                try {
                    const response = await api.fetchApi("/imagegallery/get_source_folders");
                    const data = await response.json();
                    state.availableSourceFolders = data.folders || [];
                    renderSourceFolders();
                } catch (error) {
                    console.error("Failed to load source folders:", error);
                }
            };

            const renderSourceFolders = () => {
                const currentVal = state.currentSourceFolder;
                els.sourceSelect.innerHTML = '';
                
                // Add "All Folders" option first
                const allOption = document.createElement('option');
                allOption.value = '__ALL__';
                allOption.textContent = '📂 All Folders';
                allOption.title = 'Show images from all configured folders';
                els.sourceSelect.appendChild(allOption);
                
                // Add individual folders
                state.availableSourceFolders.forEach((folder, index) => {
                    const option = document.createElement('option');
                    option.value = folder.path;
                    option.textContent = folder.name + (folder.is_default ? ' (default)' : '');
                    option.title = folder.path;
                    els.sourceSelect.appendChild(option);
                });
                
                // Restore selection
                if (currentVal && (currentVal === '__ALL__' || state.availableSourceFolders.some(f => f.path === currentVal))) {
                    els.sourceSelect.value = currentVal;
                } else if (state.availableSourceFolders.length > 0) {
                    els.sourceSelect.value = state.availableSourceFolders[0].path;
                    state.currentSourceFolder = state.availableSourceFolders[0].path;
                }
            };

            const EMPTY_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIiBmaWxsPSIjMjIyIi8+CjxwYXRoIGQ9Ik0zNSA2NUw0NSA1MEw1NSA2MEw2NSA0NUw3NSA2NUgzNVoiIGZpbGw9IiM0NDQiLz4KPGNpcmNsZSBjeD0iNjUiIGN5PSIzNSIgcj0iOCIgZmlsbD0iIzQ0NCIvPgo8L3N2Zz4=';

            // === UPDATE PREVIEW SIZE ===
            const updatePreviewSize = (size) => {
                state.previewSize = size;
                
                // Update the CSS variable for grid
                els.viewport.style.gridTemplateColumns = `repeat(auto-fill, minmax(${size}px, 1fr))`;
                
                // Calculate card height based on size (maintaining aspect ratio)
                const cardHeight = Math.round(size * 1.1);
                const imageHeight = Math.round(size * 0.9);
                state.cardHeight = cardHeight;
                
                // Update CSS custom properties on the viewport
                els.viewport.style.setProperty('--card-height', `${cardHeight}px`);
                els.viewport.style.setProperty('--image-height', `${imageHeight}px`);
                
                // Re-render visible cards
                state.visibleRange = { start: 0, end: 0 };
                renderVisibleCards();
            };

            // === VIRTUAL SCROLLING ===
            const calculateGridMetrics = () => {
                const galleryWidth = els.gallery.clientWidth - 16;
                const minCardWidth = state.previewSize;
                const gap = 8;
                state.columnsCount = Math.max(1, Math.floor((galleryWidth + gap) / (minCardWidth + gap)));
                state.cardHeight = Math.round(state.previewSize * 1.1);
            };

            const getFilteredImages = () => {
                const nameFilter = els.searchInput.value.toLowerCase();
                return state.availableImages.filter(img => 
                    img.name.toLowerCase().includes(nameFilter)
                );
            };

            const renderVisibleCards = () => {
                const filteredImages = getFilteredImages();
                const totalImages = filteredImages.length;
                
                if (totalImages === 0) {
                    els.viewport.innerHTML = '<div class="localimage-no-images">📂 No images found<br><small>Add images to the ComfyUI/input folder</small></div>';
                    els.viewport.style.height = 'auto';
                    return;
                }

                calculateGridMetrics();
                
                const rowHeight = state.cardHeight + 8;
                const totalRows = Math.ceil(totalImages / state.columnsCount);
                const totalHeight = totalRows * rowHeight;
                
                const scrollTop = els.gallery.scrollTop;
                const viewportHeight = els.gallery.clientHeight;
                
                const buffer = 2;
                const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
                const endRow = Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / rowHeight) + buffer);
                
                const startIndex = startRow * state.columnsCount;
                const endIndex = Math.min(totalImages, endRow * state.columnsCount);
                
                if (state.visibleRange.start === startIndex && state.visibleRange.end === endIndex) {
                    return;
                }
                
                state.visibleRange = { start: startIndex, end: endIndex };
                
                const topOffset = startRow * rowHeight;
                
                const fragment = document.createDocumentFragment();
                
                const topSpacer = document.createElement('div');
                topSpacer.className = 'localimage-spacer';
                topSpacer.style.height = `${topOffset}px`;
                topSpacer.style.gridColumn = '1 / -1';
                fragment.appendChild(topSpacer);
                
                const imageHeight = Math.round(state.previewSize * 0.9);
                
                for (let i = startIndex; i < endIndex; i++) {
                    const img = filteredImages[i];
                    const card = document.createElement("div");
                    card.className = "localimage-image-card";
                    if (state.selectedImage === img.original_name && 
                        (!state.selectedImageSource || state.selectedImageSource === img.source)) {
                        card.classList.add("selected");
                    }
                    card.dataset.imageName = img.name;
                    card.dataset.originalName = img.original_name || img.name;
                    card.dataset.imageSource = img.source || "";
                    card.dataset.index = i;
                    card.title = img.name;
                    card.style.height = `${state.cardHeight}px`;

                    const displayName = img.name.includes('/') || img.name.includes('\\') 
                        ? img.name.split(/[/\\]/).pop() 
                        : img.name;

                    card.innerHTML = `
                        <div class="localimage-media-container" style="height: ${imageHeight}px;">
                            <img src="${img.preview_url || EMPTY_IMAGE}" loading="lazy" decoding="async" alt="${displayName}">
                        </div>
                        <div class="localimage-image-card-info">
                            <p>${displayName}</p>
                        </div>
                    `;

                    const imgEl = card.querySelector("img");
                    imgEl.onerror = () => { imgEl.src = EMPTY_IMAGE; };
                    
                    fragment.appendChild(card);
                }
                
                const bottomOffset = totalHeight - (endRow * rowHeight);
                if (bottomOffset > 0) {
                    const bottomSpacer = document.createElement('div');
                    bottomSpacer.className = 'localimage-spacer';
                    bottomSpacer.style.height = `${bottomOffset}px`;
                    bottomSpacer.style.gridColumn = '1 / -1';
                    fragment.appendChild(bottomSpacer);
                }
                
                els.viewport.innerHTML = '';
                els.viewport.appendChild(fragment);
            };

            // Event delegation for card clicks - TOGGLE SELECTION
            els.viewport.addEventListener("click", (e) => {
                const card = e.target.closest(".localimage-image-card");
                if (!card) return;
                
                const imageName = card.dataset.imageName;
                const imageSource = card.dataset.imageSource || "";
                const originalName = card.dataset.originalName || imageName;
                
                // Toggle: if already selected, deselect; otherwise select
                if (state.selectedImage === imageName) {
                    state.selectedImage = "";
                    state.selectedImageSource = "";
                    state.selectedOriginalName = "";
                } else {
                    state.selectedImage = originalName;  // Use original name for loading
                    state.selectedImageSource = imageSource;  // Store actual source folder
                    state.selectedOriginalName = originalName;
                }
                
                updateSelection();
            });

            const fetchAndRender = async (append = false, invalidateCache = false) => {
                if (state.isLoading) return;
                
                if (invalidateCache) {
                    try {
                        await api.fetchApi("/imagegallery/invalidate_cache", { method: "POST" });
                    } catch(e) {}
                }
                
                const pageToFetch = append ? state.currentPage + 1 : 1;
                if (append && pageToFetch > state.totalPages) return;
                
                if (!append) {
                    els.viewport.innerHTML = '<div class="localimage-loading">Loading images...</div>';
                    state.visibleRange = { start: 0, end: 0 };
                }
                
                // REMOVED folder parameter
                const { images, folders } = await getImages(
                    pageToFetch, 
                    els.searchInput.value, 
                    state.metadataFilter, 
                    state.sortOrder
                );

                if (append) {
                    const existingNames = new Set(state.availableImages.map(i => i.name));
                    state.availableImages.push(...(images || []).filter(i => !existingNames.has(i.name)));
                } else {
                    state.availableImages = images || [];
                    els.gallery.scrollTop = 0;
                }
                
                renderVisibleCards();
                
                if (!append) cacheHeights();
            };

            // === UPLOAD IMAGE FUNCTION ===
            const uploadImage = async (file) => {
                const formData = new FormData();
                formData.append('image', file);
                formData.append('overwrite', 'false');
                
                try {
                    const response = await api.fetchApi('/upload/image', {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (response.ok) {
                        const result = await response.json();
                        // The response contains the filename (possibly with subfolder)
                        let uploadedName = result.name;
                        if (result.subfolder) {
                            uploadedName = `${result.subfolder}/${result.name}`;
                        }
                        return uploadedName;
                    } else {
                        const errorText = await response.text();
                        console.error("Upload failed:", errorText);
                        return null;
                    }
                } catch (error) {
                    console.error("Upload error:", error);
                    return null;
                }
            };

            // === FILE INPUT HANDLER ===
            els.fileInput.addEventListener("change", async (e) => {
                const files = e.target.files;
                if (!files || files.length === 0) return;
                
                // Show loading state on button
                const originalText = els.loadImageBtn.textContent;
                els.loadImageBtn.textContent = "⏳ Uploading...";
                els.loadImageBtn.disabled = true;
                
                let lastUploadedName = null;
                
                try {
                    for (const file of files) {
                        // Validate file type
                        if (!file.type.startsWith('image/')) {
                            console.warn(`Skipping non-image file: ${file.name}`);
                            continue;
                        }
                        
                        const uploadedName = await uploadImage(file);
                        if (uploadedName) {
                            lastUploadedName = uploadedName;
                            console.log(`Uploaded: ${uploadedName}`);
                        }
                    }
                    
                    if (lastUploadedName) {
                        // Invalidate cache and refresh
                        await api.fetchApi("/imagegallery/invalidate_cache", { method: "POST" });
                        
                        // Reset to show all folders/root to ensure we see the uploaded image
                        state.currentFolder = "";
                        els.folderSelect.value = "";
                        state.foldersRendered = false;
                        
                        // Fetch fresh data
                        await fetchAndRender(false, false);
                        
                        // Select the last uploaded image
                        state.selectedImage = lastUploadedName;
                        updateSelection();
                        
                        // Scroll to the selected image if visible
                        setTimeout(() => {
                            const selectedCard = els.viewport.querySelector(`.localimage-image-card[data-image-name="${lastUploadedName}"]`);
                            if (selectedCard) {
                                selectedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        }, 100);
                    }
                } catch (error) {
                    console.error("Error during upload:", error);
                } finally {
                    // Reset button state
                    els.loadImageBtn.textContent = originalText;
                    els.loadImageBtn.disabled = false;
                    // Clear the file input so the same file can be selected again
                    els.fileInput.value = "";
                }
            });

            // === LOAD IMAGE BUTTON CLICK ===
            els.loadImageBtn.addEventListener("click", () => {
                els.fileInput.click();
            });

            // === THROTTLED SCROLL HANDLER ===
            let scrollRAF = null;
            let lastScrollTime = 0;
            const SCROLL_THROTTLE = 16;
            
            els.gallery.addEventListener('scroll', () => {
                const now = performance.now();
                if (now - lastScrollTime < SCROLL_THROTTLE) return;
                lastScrollTime = now;
                
                if (scrollRAF) return;
                
                scrollRAF = requestAnimationFrame(() => {
                    scrollRAF = null;
                    
                    renderVisibleCards();
                    
                    if (!state.isLoading && state.currentPage < state.totalPages) {
                        const { scrollTop, scrollHeight, clientHeight } = els.gallery;
                        if (scrollHeight - scrollTop - clientHeight < 300) {
                            fetchAndRender(true);
                        }
                    }
                });
            }, { passive: true });

            // === EVENT LISTENERS ===
            els.refreshBtn.addEventListener("click", () => {
                state.foldersRendered = false;
                fetchAndRender(false, true);
            });

            els.metadataSelect.addEventListener("change", () => {
                state.metadataFilter = els.metadataSelect.value;
                fetchAndRender(false);
            });

            els.sortSelect.addEventListener("change", () => {
                state.sortOrder = els.sortSelect.value;
                LocalImageGalleryNode.setUiState(node.id, node.properties.image_gallery_unique_id, { 
                    sort_order: state.sortOrder 
                });
                fetchAndRender(false);
            });

            // Size slider handler with debouncing for state save
            let sizeSliderTimeout;
            els.sizeSlider.addEventListener("input", (e) => {
                const size = parseInt(e.target.value, 10);
                updatePreviewSize(size);
                
                // Debounce the state save
                clearTimeout(sizeSliderTimeout);
                sizeSliderTimeout = setTimeout(() => {
                    LocalImageGalleryNode.setUiState(node.id, node.properties.image_gallery_unique_id, { 
                        preview_size: state.previewSize 
                    });
                }, 500);
            });

            let searchTimeout;
            els.searchInput.addEventListener("input", () => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    state.visibleRange = { start: 0, end: 0 };
                    els.gallery.scrollTop = 0;
                    renderVisibleCards();
                }, 150);
            });
            
            els.searchInput.addEventListener("keydown", (e) => { 
                if (e.key === 'Enter') {
                    clearTimeout(searchTimeout);
                    fetchAndRender(false); 
                }
            });

            // Source folder change
            els.sourceSelect.addEventListener("change", () => {
                state.currentSourceFolder = els.sourceSelect.value;
                fetchAndRender(false);
            });

            // Folder Manager button
            els.folderManagerBtn.addEventListener("click", async () => {
                folderManager.onFoldersChanged = (folders) => {
                    state.availableSourceFolders = folders;
                    renderSourceFolders();
                };
                await folderManager.open();
            });

            // === OPTIMIZED RESIZE ===
            let resizeRAF = null;
            
            const fitHeight = () => {
                resizeRAF = null;
                if (!els.container) return;
                
                let topOffset = els.container.offsetTop;
                if (topOffset < 20) topOffset += 40;

                const targetHeight = Math.max(0, node.size[1] - topOffset - 20);
                els.container.style.cssText = `height: ${targetHeight}px; width: 100%;`;
                
                calculateGridMetrics();
                state.visibleRange = { start: 0, end: 0 };
                renderVisibleCards();
            };

            this.onResize = function(size) {
                let minHeight = state.cachedHeights.selectedDisplay + state.cachedHeights.controls + HEADER_HEIGHT + MIN_GALLERY_HEIGHT;
                
                if (size[1] < minHeight) size[1] = minHeight;
                if (size[0] < MIN_NODE_WIDTH) size[0] = MIN_NODE_WIDTH;

                if (!resizeRAF) {
                    resizeRAF = requestAnimationFrame(fitHeight);
                }
            };

            // === INITIALIZATION ===
            this.initializeNode = async () => {
                let initialState = { 
                    selected_image: "", 
                    current_folder: "", 
                    current_source_folder: "",  // ADD THIS
                    metadata_filter: "all", 
                    sort_order: "name", 
                    preview_size: 110 
                };
                
                try {
                    const res = await api.fetchApi(
                        `/imagegallery/get_ui_state?node_id=${node.id}&gallery_id=${node.properties.image_gallery_unique_id}`
                    );
                    const loadedState = await res.json();
                    initialState = { ...initialState, ...loadedState };
                } catch(e) { 
                    console.error("LocalImageGallery: Failed to get initial UI state.", e); 
                }

                // Load source folders first
                await loadSourceFolders();

                state.selectedImage = initialState.selected_image || "";
                state.currentFolder = initialState.current_folder || "";
                state.currentSourceFolder = initialState.current_source_folder || 
                    (state.availableSourceFolders.length > 0 ? state.availableSourceFolders[0].path : "");
                state.metadataFilter = initialState.metadata_filter || "all";
                state.sortOrder = initialState.sort_order || "name";
                state.previewSize = initialState.preview_size || 110;
                
                // Set source folder selection
                if (state.currentSourceFolder) {
                    els.sourceSelect.value = state.currentSourceFolder;
                }
                
                node.setProperty("selected_image", state.selectedImage);
                node.setProperty("source_folder", state.currentSourceFolder); 
                
                const widget = node.widgets.find(w => w.name === "selected_image");
                if (widget) widget.value = state.selectedImage;
                
                const sourceWidget = node.widgets.find(w => w.name === "source_folder"); 
                if (sourceWidget) sourceWidget.value = state.currentSourceFolder; 
                
                const displayName = state.selectedImage 
                    ? `ComfyUI\\input\\${state.selectedImage}` 
                    : "None";
                els.selectedName.textContent = displayName;
                els.selectedName.title = displayName;

                // Apply saved preview size
                els.sizeSlider.value = state.previewSize;
                updatePreviewSize(state.previewSize);

                await fetchAndRender();
                
                if (state.currentFolder && els.folderSelect.querySelector(`option[value="${state.currentFolder}"]`)) {
                    els.folderSelect.value = state.currentFolder;
                }
                
                if (state.metadataFilter) {
                    els.metadataSelect.value = state.metadataFilter;
                }
                
                if (state.sortOrder) {
                    els.sortSelect.value = state.sortOrder;
                }
            };

            // === CLEANUP ===
            const originalOnRemoved = this.onRemoved;
            this.onRemoved = function() {
                if (scrollRAF) cancelAnimationFrame(scrollRAF);
                if (resizeRAF) cancelAnimationFrame(resizeRAF);
                clearTimeout(searchTimeout);
                clearTimeout(sizeSliderTimeout);
                
                state.elements = {};
                state.availableImages = [];
                
                if (originalOnRemoved) originalOnRemoved.apply(this, arguments);
            };

            // Start initialization
            requestAnimationFrame(async () => {
                await this.initializeNode();
                fitHeight();
            });

            return result;
        };

        // Global styles - only inject once
        nodeType.prototype._ensureGlobalStyles = function() {
            if (document.getElementById('localimage-gallery-styles')) return;
            
            const style = document.createElement('style');
            style.id = 'localimage-gallery-styles';
            style.textContent = `
                .localimage-root .localimage-size-control .folder-manager-btn {
                    background: #3a3a5a;
                    color: #fff;
                    border: none;
                    border-radius: 4px;
                    padding: 6px 12px;
                    cursor: pointer;
                    font-size: 14px;
                    flex-shrink: 0;
                    white-space: nowrap;
                    transition: background 0.2s;
                }
                .localimage-root .localimage-size-control .folder-manager-btn:hover {
                    background: #4a4a7a;
                }
                .localimage-root .localimage-container { 
                    display: flex; flex-direction: column; height: 100%; 
                    font-family: sans-serif; overflow: hidden; 
                    background-color: #1e1e1e; border-radius: 4px;
                    contain: layout style;
                }
                .localimage-root .localimage-selected-display { 
                    padding: 12px 10px; background-color: #252525; 
                    border-bottom: 1px solid #3a3a3a; flex-shrink: 0; 
                    display: flex; align-items: center; gap: 8px;
                }
                .localimage-root .localimage-selected-display .label { font-size: 15px; color: #888; }
                .localimage-root .localimage-selected-display .selected-name { 
                    color: #00FFC9; font-weight: bold; font-size: 15px; flex-grow: 1;
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                }
                .localimage-root .localimage-controls { 
                    display: flex; padding: 8px; gap: 8px; align-items: center; 
                    flex-shrink: 0; background-color: #252525;
                    border-bottom: 1px solid #3a3a3a; flex-wrap: wrap;
                }
                .localimage-root .localimage-controls input[type=text] { 
                    flex-grow: 1; min-width: 100px; background: #333; color: #ccc; 
                    border: 1px solid #555; padding: 12px 10px; border-radius: 4px; font-size: 15px;
                }
                .localimage-root .localimage-controls input[type=text]:focus { outline: none; border-color: #00FFC9; }
                .localimage-root .localimage-controls select {
                    background: #333;
                    color: #ccc;
                    border: 1px solid #555;
                    padding: 12px 12px;
                    border-radius: 4px;
                    font-size: 15px;
                    width: 200px;
                    min-width: 200px;
                    max-width: 200px;
                }
                .localimage-root .localimage-controls button {
                    background: #444; color: #fff; border: none; border-radius: 4px;
                    padding: 6px 6px; cursor: pointer; font-size: 24px; flex-shrink: 0;
                }
                .localimage-root .localimage-controls button:hover { background: #555; }
                
                /* Size control slider styles */
                .localimage-root .localimage-size-control {
                    display: flex; align-items: center; gap: 8px;
                    padding: 8px 10px; background-color: #252525;
                    border-bottom: 1px solid #3a3a3a; flex-shrink: 0;
                }
                .localimage-root .localimage-size-control .size-label {
                    flex-shrink: 0; line-height: 1;
                }
                .localimage-root .localimage-size-control .size-label-small {
                    font-size: 15px;
                }
                .localimage-root .localimage-size-control .size-label-large {
                    font-size: 20px;
                }
                .localimage-root .localimage-size-control .size-slider {
                    flex-grow: 1; height: 8px; -webkit-appearance: none; appearance: none;
                    background: #444; border-radius: 2px; outline: none; cursor: pointer;
                }
                .localimage-root .localimage-size-control .size-slider::-webkit-slider-thumb {
                    -webkit-appearance: none; appearance: none; width: 24px; height: 24px;
                    background: #00A68C; border-radius: 50%; cursor: pointer;
                    transition: background 0.2s;
                }

                .localimage-root .localimage-size-control .size-slider::-webkit-slider-thumb:hover {
                    background: #008C74;  /* slightly darker hover */
                }

                .localimage-root .localimage-size-control .size-slider::-moz-range-thumb {
                    width: 14px; height: 14px; background: #00FFC9; border-radius: 50%;
                    cursor: pointer; border: none;
                }
                
                /* Load image button styles */
                .localimage-root .localimage-size-control .load-image-btn {
                    background: #2a6a4a; color: #fff; border: none; border-radius: 4px;
                    padding: 6px 12px; cursor: pointer; font-size: 14px; flex-shrink: 0;
                    white-space: nowrap; transition: background 0.2s;
                }
                .localimage-root .localimage-size-control .load-image-btn:hover {
                    background: #3a8a5a;
                }
                .localimage-root .localimage-size-control .load-image-btn:disabled {
                    background: #555; cursor: not-allowed; opacity: 0.7;
                }
                
                .localimage-root .localimage-gallery { 
                    flex: 1 1 0; min-height: 0; overflow-y: auto; overflow-x: hidden; 
                    background-color: #1a1a1a;
                    contain: strict;
                }
                .localimage-root .localimage-gallery-viewport {
                    padding: 8px; 
                    display: grid; 
                    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); 
                    gap: 8px; 
                    align-content: start;
                }
                .localimage-root .localimage-spacer {
                    pointer-events: none;
                }
                .localimage-root .localimage-image-card { 
                    cursor: pointer; border: 4px solid transparent; border-radius: 6px; 
                    background-color: #2a2a2a; display: flex; flex-direction: column; 
                    position: relative; overflow: hidden;
                    contain: layout style paint;
                    transition: border-color 0.2s;
                }
                .localimage-root .localimage-image-card:hover { 
                    border-color: #555;
                }
                .localimage-root .localimage-image-card.selected { 
                    border-color: #00FFC9; box-shadow: 0 0 10px rgba(0, 255, 201, 0.3); 
                }
                .localimage-root .localimage-media-container { 
                    width: 100%; background-color: #111; 
                    overflow: hidden; display: flex; align-items: center; 
                    justify-content: center; flex-shrink: 0;
                }
                .localimage-root .localimage-media-container img { 
                    width: 100%; height: 100%; object-fit: cover;
                }
                .localimage-root .localimage-image-card-info { 
                    padding: 4px 6px; background: #2a2a2a; flex-grow: 1;
                    display: flex; align-items: center; justify-content: center;
                }
                .localimage-root .localimage-image-card p { 
                    font-size: 12px; margin: 0; word-break: break-word; text-align: center; 
                    color: #aaa; line-height: 1.2; max-height: 26px; overflow: hidden;
                    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
                }
                .localimage-root .localimage-gallery::-webkit-scrollbar { width: 16px; }
                .localimage-root .localimage-gallery::-webkit-scrollbar-track { background: #2a2a2a; border-radius: 4px; }
                .localimage-root .localimage-gallery::-webkit-scrollbar-thumb { background-color: #555; border-radius: 4px; }
                .localimage-root .localimage-gallery::-webkit-scrollbar-thumb:hover { background-color: #777; }
                .localimage-root .localimage-loading, .localimage-root .localimage-no-images {
                    grid-column: 1 / -1; text-align: center; padding: 20px; color: #666; font-size: 14px;
                }
            `;
            document.head.appendChild(style);
        };
    }
};

app.registerExtension({
    name: "LocalImageGallery.GalleryUI",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "LocalImageGallery") {
            LocalImageGalleryNode.setup(nodeType, nodeData);
        }
    },
});
