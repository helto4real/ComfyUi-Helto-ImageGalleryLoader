// folder_manager.js

import { api } from "../../scripts/api.js";

/**
 * Folder Manager for LocalImageGallery
 * Handles adding/removing custom source folders with native folder picker
 */
export class FolderManager {
    constructor() {
        this.modalElement = null;
        this.folders = [];
        this.onFoldersChanged = null; // Callback when folders change
        this._ensureStyles();
    }

    _ensureStyles() {
        if (document.getElementById('folder-manager-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'folder-manager-styles';
        style.textContent = `
            .folder-manager-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                backdrop-filter: blur(2px);
            }
            
            .folder-manager-modal {
                background: #2a2a2a;
                border: 1px solid #444;
                border-radius: 8px;
                width: 600px;
                max-width: 90vw;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
            }
            
            .folder-manager-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px 20px;
                border-bottom: 1px solid #444;
                background: #333;
                border-radius: 8px 8px 0 0;
            }
            
            .folder-manager-header h2 {
                margin: 0;
                font-size: 18px;
                color: #fff;
                font-weight: 600;
            }
            
            .folder-manager-close {
                background: none;
                border: none;
                color: #888;
                font-size: 24px;
                cursor: pointer;
                padding: 0;
                line-height: 1;
                transition: color 0.2s;
            }
            
            .folder-manager-close:hover {
                color: #fff;
            }
            
            .folder-manager-content {
                flex: 1;
                overflow-y: auto;
                padding: 20px;
            }
            
            .folder-manager-add-section {
                margin-bottom: 24px;
                padding-bottom: 20px;
                border-bottom: 1px solid #444;
            }
            
            .folder-manager-add-section h3 {
                margin: 0 0 12px 0;
                font-size: 14px;
                color: #aaa;
                font-weight: 500;
            }
            
            .folder-manager-add-row {
                display: flex;
                gap: 10px;
                align-items: center;
            }
            
            .folder-manager-browse-btn {
                background: #2a6a4a;
                border: none;
                border-radius: 4px;
                padding: 12px 24px;
                color: #fff;
                font-size: 14px;
                cursor: pointer;
                transition: background 0.2s;
                white-space: nowrap;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .folder-manager-browse-btn:hover {
                background: #3a8a5a;
            }
            
            .folder-manager-browse-btn:disabled {
                background: #444;
                opacity: 0.6;
                cursor: not-allowed;
            }
            
            .folder-manager-browse-btn .icon {
                font-size: 18px;
            }
            
            .folder-manager-help {
                flex: 1;
                font-size: 13px;
                color: #888;
                line-height: 1.4;
            }
            
            .folder-manager-list-section h3 {
                margin: 0 0 12px 0;
                font-size: 14px;
                color: #aaa;
                font-weight: 500;
            }
            
            .folder-manager-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            
            .folder-manager-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 14px;
                background: #1e1e1e;
                border: 1px solid #444;
                border-radius: 6px;
                transition: border-color 0.2s;
            }
            
            .folder-manager-item:hover {
                border-color: #555;
            }
            
            .folder-manager-item.default {
                border-color: #00FFC9;
                background: #1e2a25;
            }
            
            .folder-manager-item-icon {
                font-size: 20px;
                flex-shrink: 0;
            }
            
            .folder-manager-item-info {
                flex: 1;
                min-width: 0;
            }
            
            .folder-manager-item-name {
                font-size: 14px;
                font-weight: 500;
                color: #fff;
                margin-bottom: 2px;
            }
            
            .folder-manager-item-path {
                font-size: 12px;
                color: #888;
                font-family: monospace;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            
            .folder-manager-item-badge {
                font-size: 11px;
                padding: 2px 8px;
                background: #00FFC9;
                color: #000;
                border-radius: 10px;
                font-weight: 500;
            }
            
            .folder-manager-item-remove {
                background: #5a2a2a;
                border: none;
                border-radius: 4px;
                padding: 6px 12px;
                color: #ff6b6b;
                font-size: 12px;
                cursor: pointer;
                transition: background 0.2s;
            }
            
            .folder-manager-item-remove:hover {
                background: #7a3a3a;
            }
            
            .folder-manager-item-remove:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            
            .folder-manager-empty {
                text-align: center;
                padding: 20px;
                color: #666;
                font-style: italic;
            }
            
            .folder-manager-message {
                padding: 10px 14px;
                border-radius: 4px;
                margin-bottom: 16px;
                font-size: 13px;
                display: none;
            }
            
            .folder-manager-message.error {
                background: #5a2a2a;
                border: 1px solid #ff6b6b;
                color: #ff6b6b;
                display: block;
            }
            
            .folder-manager-message.success {
                background: #2a5a3a;
                border: 1px solid #00FFC9;
                color: #00FFC9;
                display: block;
            }
            
            .folder-manager-message.info {
                background: #2a3a5a;
                border: 1px solid #6b9fff;
                color: #6b9fff;
                display: block;
            }
        `;
        document.head.appendChild(style);
    }

    async loadFolders() {
        try {
            const response = await api.fetchApi("/imagegallery/get_source_folders");
            const data = await response.json();
            this.folders = data.folders || [];
            return this.folders;
        } catch (error) {
            console.error("Failed to load folders:", error);
            return [];
        }
    }

    async browseForFolder() {
        try {
            this.showMessage('Opening folder picker...', 'info');
            
            const response = await api.fetchApi("/imagegallery/browse_folder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({})
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || "Failed to open folder picker");
            }
            
            if (data.cancelled) {
                this.hideMessage();
                return null;
            }
            
            return data.path;
        } catch (error) {
            console.error("Browse folder error:", error);
            throw error;
        }
    }

    async addFolder(folderPath) {
        try {
            const response = await api.fetchApi("/imagegallery/add_source_folder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: folderPath })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || "Failed to add folder");
            }
            
            this.folders = data.folders || [];
            
            if (this.onFoldersChanged) {
                this.onFoldersChanged(this.folders);
            }
            
            return { success: true, folders: this.folders };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async removeFolder(folderPath) {
        try {
            const response = await api.fetchApi("/imagegallery/remove_source_folder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: folderPath })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || "Failed to remove folder");
            }
            
            this.folders = data.folders || [];
            
            if (this.onFoldersChanged) {
                this.onFoldersChanged(this.folders);
            }
            
            return { success: true, folders: this.folders };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async open() {
        if (this.modalElement) {
            this.close();
        }
        
        await this.loadFolders();
        
        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'folder-manager-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.close();
        });
        
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'folder-manager-modal';
        modal.innerHTML = `
            <div class="folder-manager-header">
                <h2>📁 Source Folder Manager</h2>
                <button class="folder-manager-close" title="Close">×</button>
            </div>
            <div class="folder-manager-content">
                <div class="folder-manager-message"></div>
                
                <div class="folder-manager-add-section">
                    <h3>Add New Source Folder</h3>
                    <div class="folder-manager-add-row">
                        <button class="folder-manager-browse-btn">
                            <span class="icon">📂</span>
                            <span>Browse for Folder...</span>
                        </button>
                        <div class="folder-manager-help">
                            Click to open the folder picker and select any folder from your computer.
                        </div>
                    </div>
                </div>
                
                <div class="folder-manager-list-section">
                    <h3>Configured Source Folders</h3>
                    <div class="folder-manager-list"></div>
                </div>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        this.modalElement = overlay;
        
        // Bind events
        const closeBtn = modal.querySelector('.folder-manager-close');
        closeBtn.addEventListener('click', () => this.close());
        
        const browseBtn = modal.querySelector('.folder-manager-browse-btn');
        
        browseBtn.addEventListener('click', async () => {
            browseBtn.disabled = true;
            const originalHTML = browseBtn.innerHTML;
            browseBtn.innerHTML = '<span class="icon">⏳</span><span>Opening picker...</span>';
            
            try {
                const folderPath = await this.browseForFolder();
                
                if (folderPath) {
                    browseBtn.innerHTML = '<span class="icon">⏳</span><span>Adding folder...</span>';
                    
                    const result = await this.addFolder(folderPath);
                    
                    if (result.success) {
                        this.showMessage(`Folder added: ${folderPath}`, 'success');
                        this.renderFolderList();
                    } else {
                        this.showMessage(result.error, 'error');
                    }
                }
            } catch (error) {
                this.showMessage(error.message, 'error');
            } finally {
                browseBtn.disabled = false;
                browseBtn.innerHTML = originalHTML;
            }
        });
        
        // Handle escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                this.close();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
        
        // Render folder list
        this.renderFolderList();
    }

    showMessage(message, type = 'error') {
        const msgEl = this.modalElement?.querySelector('.folder-manager-message');
        if (!msgEl) return;
        
        msgEl.className = `folder-manager-message ${type}`;
        msgEl.textContent = message;
        
        if (type === 'success') {
            setTimeout(() => this.hideMessage(), 3000);
        }
    }

    hideMessage() {
        const msgEl = this.modalElement?.querySelector('.folder-manager-message');
        if (msgEl) {
            msgEl.className = 'folder-manager-message';
            msgEl.textContent = '';
        }
    }

    renderFolderList() {
        const listEl = this.modalElement.querySelector('.folder-manager-list');
        
        if (this.folders.length === 0) {
            listEl.innerHTML = '<div class="folder-manager-empty">No folders configured</div>';
            return;
        }
        
        listEl.innerHTML = this.folders.map(folder => `
            <div class="folder-manager-item ${folder.is_default ? 'default' : ''}" data-path="${this.escapeHtml(folder.path)}">
                <span class="folder-manager-item-icon">📁</span>
                <div class="folder-manager-item-info">
                    <div class="folder-manager-item-name">${this.escapeHtml(folder.name)}</div>
                    <div class="folder-manager-item-path" title="${this.escapeHtml(folder.path)}">${this.escapeHtml(folder.path)}</div>
                </div>
                ${folder.is_default ? '<span class="folder-manager-item-badge">Default</span>' : `
                    <button class="folder-manager-item-remove" data-path="${this.escapeHtml(folder.path)}">Remove</button>
                `}
            </div>
        `).join('');
        
        // Bind remove buttons
        listEl.querySelectorAll('.folder-manager-item-remove').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const path = e.target.dataset.path;
                if (!path) return;
                
                btn.disabled = true;
                btn.textContent = 'Removing...';
                
                const result = await this.removeFolder(path);
                
                if (result.success) {
                    this.showMessage('Folder removed successfully!', 'success');
                    this.renderFolderList();
                } else {
                    btn.disabled = false;
                    btn.textContent = 'Remove';
                    this.showMessage(result.error, 'error');
                }
            });
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    close() {
        if (this.modalElement) {
            this.modalElement.remove();
            this.modalElement = null;
        }
    }
}

// Singleton instance
export const folderManager = new FolderManager();
