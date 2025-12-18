const AUTH0_REDIRECT_URI = window.location.origin + window.location.pathname;
let isAuthenticated = false;
let collections = [];
let authStep = 'initial'; // 'initial', 'authenticating', 'authenticated', 'loading', 'ready'

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const loginBtn = document.getElementById('login-btn');
const loginDescription = document.getElementById('login-description');
const statusMessage = document.getElementById('status-message');
const logoutBtn = document.getElementById('logout-btn');
const foldersLoading = document.getElementById('folders-loading');
const foldersList = document.getElementById('folders-list');
const foldersError = document.getElementById('folders-error');
const pageTitle = document.getElementById('page-title');
const welcomeView = document.getElementById('welcome-view');
const folderView = document.getElementById('folder-view');
const folderTitle = document.getElementById('folder-title');
const folderDetails = document.getElementById('folder-details');
const folderDescription = document.getElementById('folder-description');
const fontView = document.getElementById('font-view');
const fontTitle = document.getElementById('font-title');
const fontLoading = document.getElementById('font-loading');
const fontDetails = document.getElementById('font-details');

// Show status message
function showStatus(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = `status-message status-${type}`;
    statusMessage.classList.remove('hidden');
}

// Hide status message
function hideStatus() {
    statusMessage.classList.add('hidden');
}

// Update login UI based on auth step
function updateLoginUI() {
    switch (authStep) {
        case 'initial':
            loginBtn.textContent = 'Connect to Font Library';
            loginBtn.disabled = false;
            loginDescription.textContent = 'Professional font management for creative teams';
            hideStatus();
            break;
        case 'authenticating':
            loginBtn.textContent = 'Connecting...';
            loginBtn.disabled = true;
            showStatus('Redirecting to Monotype authentication...', 'info');
            break;
        case 'authenticated':
            loginBtn.textContent = 'Loading Collections...';
            loginBtn.disabled = true;
            showStatus('Authentication successful! Loading your font collections...', 'success');
            break;
        case 'loading':
            loginBtn.textContent = 'Loading Collections...';
            loginBtn.disabled = true;
            showStatus('Fetching your font library collections...', 'info');
            break;
        case 'error':
            loginBtn.textContent = 'Retry Connection';
            loginBtn.disabled = false;
            break;
    }
}

// Get query params from URL
function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        code: params.get('code'),
        state: params.get('state')
    };
}

// Redirect to Auth0 login
function redirectToLogin() {
    authStep = 'authenticating';
    updateLoginUI();

    setTimeout(() => {
        const authUrl = `/api/authorize?redirect_uri=${encodeURIComponent(AUTH0_REDIRECT_URI)}`;
        window.location.href = authUrl;
    }, 1500);
}

// Exchange authorization code for tokens
async function exchangeCodeForTokens(code) {
    try {
        authStep = 'authenticated';
        updateLoginUI();

        const tokenUrl = `/api/token`;
        const body = {
            code: code,
            redirect_uri: AUTH0_REDIRECT_URI
        };
        const formBody = new URLSearchParams(body).toString();
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formBody
        });

        const result = await response.json();
        console.log('Token exchange result:', result);

        if (result.success) {
            isAuthenticated = true;
            authStep = 'loading';
            updateLoginUI();

            // Wait a moment to show the success message and avoid rate limiting
            setTimeout(async () => {
                await loadCollections();
            }, 3000); // Increased delay to 3 seconds to avoid rate limiting
        } else {
            throw new Error(result.message || 'Authentication failed');
        }

        return result;
    } catch (error) {
        console.error('Error during token exchange:', error);
        authStep = 'error';
        updateLoginUI();
        showStatus(`Authentication failed: ${error.message}`, 'error');
    }
}        // Load collections from API
async function loadCollections() {
    try {
        foldersLoading.classList.remove('hidden');
        foldersError.classList.add('hidden');
        foldersList.classList.add('hidden');

        console.log('Making request to /api/proxy/v1/fontslibrary/collections');
        const response = await fetch('/api/proxy/v1/fontslibrary/collections', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        console.log('Response status:', response.status);
        console.log('Response headers:', Object.fromEntries(response.headers.entries()));

        const result = await response.json();
        console.log('API Response:', result);

        if (response.status === 429) {
            throw new Error('Rate limit exceeded. Please wait a moment and try again.');
        } else if (response.ok) {
            // The API returns a direct array of collections
            if (Array.isArray(result)) {
                collections = result;
            } else if (result.data && Array.isArray(result.data)) {
                collections = result.data;
            } else {
                console.warn('Unexpected response structure:', result);
                collections = [];
            }

            console.log('Parsed collections:', collections);

            renderCollections();

            // Successfully loaded - show the app
            authStep = 'ready';
            showApp();
            showStatus('Successfully connected to your font library!', 'success');
            setTimeout(hideStatus, 3000);
        } else if (result.error === "Not authenticated") {
            throw new Error('Session expired. Please log in again.');
        } else {
            throw new Error(result.message || `HTTP ${response.status}: Failed to load collections`);
        }
    } catch (error) {
        console.error('Error loading collections:', error);
        authStep = 'error';
        foldersLoading.classList.add('hidden');
        foldersError.classList.remove('hidden');

        if (error.message.includes('Session expired') || error.message.includes('Not authenticated')) {
            showLogin();
            showStatus('Session expired. Please reconnect to your font library.', 'error');
        } else if (error.message.includes('Rate limit exceeded')) {
            updateLoginUI();
            showStatus('Rate limit exceeded. Please wait a moment and try again.', 'error');

            // Add retry button for rate limit
            setTimeout(() => {
                if (authStep === 'error') {
                    loginBtn.textContent = 'Retry Loading Collections';
                    showStatus('Ready to retry loading collections.', 'info');
                }
            }, 5000);
        } else {
            updateLoginUI();
            showStatus(`Failed to load collections: ${error.message}`, 'error');
        }
    }
}

// Render collections in sidebar
function renderCollections() {
    foldersLoading.classList.add('hidden');
    foldersError.classList.add('hidden');
    foldersList.classList.remove('hidden');

    foldersList.innerHTML = '';

    if (!collections || collections.length === 0) {
        // Show message when no collections are found
        const noCollectionsItem = document.createElement('div');
        noCollectionsItem.className = 'loading';
        noCollectionsItem.textContent = 'No collections found';
        foldersList.appendChild(noCollectionsItem);
        return;
    }

    collections.forEach((collection, index) => {
        renderCollectionItem(collection, index, foldersList, false);
    });
}

// Render a single collection item (parent or child)
function renderFontItem(font, index, container, parentFontSet) {
    console.log('Rendering font item:', font.name || font.displayName, 'from FontSet:', parentFontSet.displayName);
    console.log('Font object properties:', Object.keys(font));
    console.log('Full font object:', font);

    const fontItem = document.createElement('div');
    fontItem.className = 'collection-item font-item';
    fontItem.dataset.assetId = font.assetId;
    fontItem.dataset.assetType = font.assetType;

    const fontLink = document.createElement('div');
    fontLink.className = 'collection-link';

    const fontIcon = document.createElement('span');
    fontIcon.className = 'icon';
    fontIcon.innerHTML = '📝'; // Font icon

    const fontName = document.createElement('span');
    fontName.className = 'name';
    fontName.innerHTML = font.name || font.displayName || `Font ${index + 1}`; // Changed from textContent to innerHTML

    fontLink.appendChild(fontIcon);
    fontLink.appendChild(fontName);
    fontItem.appendChild(fontLink);

    // Add click handler for font selection
    fontLink.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Remove selection from other fonts
        container.querySelectorAll('.font-item').forEach(item => {
            item.classList.remove('selected');
        });

        // Select this font
        fontItem.classList.add('selected');

        const fontName = font.name || font.displayName;
        console.log('Selected font:', fontName);
        console.log('Available IDs - assetId:', font.assetId, 'id:', font.id, 'fontId:', font.fontId);

        // Try to determine the correct font ID for the API call
        const fontId = font.fontId || font.id || font.assetId;
        console.log('Using font ID for API call:', fontId);

        // Show font details in main panel
        await showFontDetails(fontId, fontName);
    });

    container.appendChild(fontItem);
}

function renderCollectionItem(collection, index, parentElement, isSubItem = false) {
    const collectionId = collection.id;
    const collectionName = collection.name;
    const assetType = collection.assetType;

    // Count fonts based on asset type and children structure
    let fontCount = 0;
    let hasSubItems = false;

    if (collection.children && collection.children.length > 0) {
        if (assetType === 'Folder') {
            // For folders, count fonts from all child types (FontSets, WebProjects, and direct Variations)
            fontCount = collection.children.reduce((total, child) => {
                if (child.assetType === 'FontSet' && child.children) {
                    // Count fonts in FontSets
                    return total + child.children.filter(c => c.assetType === 'Variation').length;
                } else if (child.assetType === 'WebProject' && child.children) {
                    // Count fonts in WebProjects
                    return total + child.children.filter(c => c.assetType === 'Variation').length;
                } else if (child.assetType === 'Variation') {
                    // Count direct font variations
                    return total + 1;
                }
                return total;
            }, 0);
            // Folders have sub-items if they contain FontSets, WebProjects, or direct fonts
            hasSubItems = collection.children.some(child =>
                child.assetType === 'FontSet' ||
                child.assetType === 'WebProject' ||
                child.assetType === 'Variation'
            );
        } else if (assetType === 'FontSet' || assetType === 'WebProject') {
            // For FontSets and WebProjects, count variation children directly (both can only contain fonts)
            fontCount = collection.children.filter(child => child.assetType === 'Variation').length;
            // FontSets and WebProjects have sub-items (fonts) if they have variations
            hasSubItems = fontCount > 0;
        } else {
            // For other types, just count children
            fontCount = collection.children.length;
        }
    }

    // Choose appropriate icon based on asset type
    let icon = '📁';
    if (assetType === 'FontSet') icon = '🔤';
    else if (assetType === 'WebProject') icon = '🌐';

    // Create the main item container
    const itemContainer = document.createElement('div');

    // Create the folder item
    const folderItem = document.createElement('div');
    folderItem.className = isSubItem ? 'sub-folder-item' : 'folder-item';
    if (hasSubItems && !isSubItem) {
        folderItem.classList.add('has-children');
    }

    folderItem.dataset.collectionId = collectionId;

    const expandIcon = hasSubItems ? '<span class="folder-expand-icon">▶</span>' : '';
    const countClass = isSubItem ? 'sub-folder-count' : 'folder-count';

    folderItem.innerHTML = `
        <span>${expandIcon}${icon} ${collectionName}</span>
        <span class="${countClass}">${fontCount}</span>
    `;

    // Add click handler
    folderItem.addEventListener('click', (e) => {
        e.stopPropagation();

        if (hasSubItems) {
            // Toggle expansion for items with children (folders or fontsets)
            toggleSubFolders(itemContainer, collection);
        }

        // Show collection details
        showCollection({
            id: collectionId,
            name: collectionName,
            assetType: assetType,
            fontCount: fontCount,
            children: collection.children,
            ...collection
        });
    });

    itemContainer.appendChild(folderItem);

    // Create sub-folders container if this item has children
    if (hasSubItems) {
        const subFoldersContainer = document.createElement('div');
        subFoldersContainer.className = 'sub-folders';
        subFoldersContainer.dataset.parentId = collectionId;

        if (assetType === 'Folder') {
            // For folders, render all child types (FontSets, WebProjects, and direct fonts)
            collection.children.forEach((child, childIndex) => {
                if (child.assetType === 'FontSet' || child.assetType === 'WebProject') {
                    // Render FontSets and WebProjects as sub-items
                    renderCollectionItem(child, childIndex, subFoldersContainer, true);
                } else if (child.assetType === 'Variation') {
                    // Render direct font variations
                    subFoldersContainer.classList.add('has-fonts');
                    renderFontItem(child, childIndex, subFoldersContainer, collection);
                }
            });
        } else if (assetType === 'FontSet' || assetType === 'WebProject') {
            // For FontSets and WebProjects, render individual font variations only
            subFoldersContainer.classList.add('has-fonts');
            collection.children.forEach((font, fontIndex) => {
                if (font.assetType === 'Variation') {
                    renderFontItem(font, fontIndex, subFoldersContainer, collection);
                }
            });
        }

        itemContainer.appendChild(subFoldersContainer);
    }

    parentElement.appendChild(itemContainer);
}

// Toggle sub-folders visibility
function toggleSubFolders(container, collection) {
    const subFoldersContainer = container.querySelector('.sub-folders');
    const expandIcon = container.querySelector('.folder-expand-icon');

    if (subFoldersContainer && expandIcon) {
        const isExpanded = subFoldersContainer.classList.contains('expanded');

        if (isExpanded) {
            subFoldersContainer.classList.remove('expanded');
            expandIcon.classList.remove('expanded');
        } else {
            subFoldersContainer.classList.add('expanded');
            expandIcon.classList.add('expanded');
        }
    }
}

// Show collection details
function showCollection(collection) {
    pageTitle.innerHTML = `Collection: ${collection.name}`;
    folderTitle.innerHTML = collection.name;

    // Update active state for both folder-item and sub-folder-item
    document.querySelectorAll('.folder-item, .sub-folder-item').forEach(item => item.classList.remove('active'));
    const activeItem = document.querySelector(`[data-collection-id="${collection.id}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
    }

    // Show folder view
    welcomeView.classList.add('hidden');
    fontView.classList.add('hidden');
    folderView.classList.remove('hidden');

    // Render collection details
    folderDetails.innerHTML = `
        <div class="detail-card">
            <div class="detail-label">Collection ID</div>
            <div class="detail-value">${collection.id}</div>
        </div>
        <div class="detail-card">
            <div class="detail-label">Asset Type</div>
            <div class="detail-value">${collection.assetType || 'Unknown'}</div>
        </div>
        <div class="detail-card">
            <div class="detail-label">Font Count</div>
            <div class="detail-value">${collection.fontCount || 0}</div>
        </div>
        <div class="detail-card">
            <div class="detail-label">Children Count</div>
            <div class="detail-value">${collection.children ? collection.children.length : 0}</div>
        </div>
    `;

    // Generate description based on asset type and contents
    let description = '';
    if (collection.assetType === 'Folder') {
        const fontSets = collection.children ? collection.children.filter(c => c.assetType === 'FontSet').length : 0;
        description = `This folder contains ${fontSets} font set(s) with a total of ${collection.fontCount} font variations.`;
    } else if (collection.assetType === 'FontSet') {
        description = `This font set contains ${collection.fontCount} font variations.`;
    } else if (collection.assetType === 'WebProject') {
        description = `This is a web project collection.`;
    } else {
        description = `Collection of type "${collection.assetType}".`;
    }

    folderDescription.innerHTML = `<p class="folder-description-text">${description}</p>`;
}

// Show font details
async function showFontDetails(fontAssetId, fontName) {
    try {
        pageTitle.innerHTML = `Font: ${fontName}`;
        fontTitle.innerHTML = fontName;

        // Hide other views and show font view
        welcomeView.classList.add('hidden');
        folderView.classList.add('hidden');
        fontView.classList.remove('hidden');

        // Show loading state
        fontLoading.classList.remove('hidden');
        fontDetails.innerHTML = '';

        console.log('Fetching font details for asset ID:', fontAssetId);
        const response = await fetch(`/api/proxy/v1/fonts/${fontAssetId}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        console.log('Font details response status:', response.status);
        const result = await response.json();
        console.log('Font details API Response:', result);

        fontLoading.classList.add('hidden');

        if (response.ok) {
            // The API response has a 'font' property containing the font data
            const fontData = result.font || result.data || result;
            renderFontDetails(fontData);
        } else {
            fontDetails.innerHTML = `
                <div class="detail-card detail-card-error">
                    <div class="detail-label">Error</div>
                    <div class="detail-value">Failed to load font details: ${result.message || response.statusText}</div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error fetching font details:', error);
        fontLoading.classList.add('hidden');
        fontDetails.innerHTML = `
            <div class="detail-card detail-card-error">
                <div class="detail-label">Error</div>
                <div class="detail-value">Failed to load font details: ${error.message}</div>
            </div>
        `;
    }
}

// Render font details
function renderFontDetails(fontData) {
    const previewText = "The quick brown fox jumps over the lazy dog";

    fontDetails.innerHTML = `
        ${fontData.sample ? `
        <div class="font-sample">
            <div class="detail-label">Official Font Sample</div>
            <img src="${fontData.sample}" alt="Font sample for ${fontData.friendlyName || fontData.name}" 
                 onerror="this.parentElement.style.display='none';" />
        </div>
        ` : ''}
        
        <div class="font-download-section">
            <button class="download-btn" onclick="downloadFont('${fontData.fontId || fontData.id}')">
                <span class="icon">⬇</span>
                Download Font
            </button>
        </div>
        
        <div class="font-metadata">
            <div class="detail-label">Font Name</div>
            <div class="detail-value">${fontData.friendlyName || fontData.name || 'Unknown'}</div>
        </div>
        
        <div class="font-metadata">
            <div class="detail-label">PostScript Name</div>
            <div class="detail-value">${fontData.psName || 'Unknown'}</div>
        </div>
        
        <div class="font-metadata">
            <div class="detail-label">Font ID</div>
            <div class="detail-value">${fontData.fontId || 'Unknown'}</div>
        </div>
        
        <div class="font-metadata">
            <div class="detail-label">Font Family</div>
            <div class="detail-value">${fontData.family || 'Unknown'}</div>
        </div>
        
        <div class="font-metadata">
            <div class="detail-label">Style</div>
            <div class="detail-value">${fontData.style || 'Unknown'}</div>
        </div>
        
        <div class="font-metadata">
            <div class="detail-label">Weight (CSS)</div>
            <div class="detail-value">${fontData.weightCSS || 'Unknown'}</div>
        </div>
        
        <div class="font-metadata">
            <div class="detail-label">Foundry</div>
            <div class="detail-value">${fontData.foundry || 'Unknown'}</div>
        </div>
        
        <div class="font-metadata">
            <div class="detail-label">Format</div>
            <div class="detail-value">${fontData.format || 'Unknown'}</div>
        </div>
        
        ${fontData.description ? `
        <div class="font-metadata full-width">
            <div class="detail-label">Description</div>
            <div class="detail-value">${fontData.description}</div>
        </div>
        ` : ''}
        
        ${fontData.classification && fontData.classification.length > 0 ? `
        <div class="font-metadata full-width">
            <div class="detail-label">Classification</div>
            <div class="detail-value">
                ${fontData.classification.map(cls => `<span class="classification-tag">${cls}</span>`).join('')}
            </div>
        </div>
        ` : ''}
        
        ${fontData.tag && fontData.tag.length > 0 ? `
        <div class="font-metadata full-width">
            <div class="detail-label">Tags</div>
            <div class="detail-value">
                ${fontData.tag.map(tag => `<span class="tag-badge">${tag}</span>`).join('')}
            </div>
        </div>
        ` : ''}
        
        ${fontData.publicTags && fontData.publicTags.length > 0 ? `
        <div class="font-metadata full-width">
            <div class="detail-label">Public Tags</div>
            <div class="detail-value public-tags-container">
                ${fontData.publicTags.map(tag => `<span class="public-tag">${tag}</span>`).join('')}
            </div>
        </div>
        ` : ''}
    `;
}

// Download font function
async function downloadFont(fontId) {
    if (!fontId) {
        alert('Font ID not available for download');
        return;
    }

    try {
        const downloadBtn = document.querySelector('.download-btn');
        const originalText = downloadBtn.innerHTML;

        // Update button to show loading state
        downloadBtn.innerHTML = '<span class="icon">⏳</span> Downloading...';
        downloadBtn.disabled = true;
        downloadBtn.style.background = '#95a5a6';

        // Make request to download endpoint
        const response = await fetch(`/api/proxy/v1/fonts/${fontId}/download?directDownload=true`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Download failed: ${response.status} ${response.statusText}`);
        }

        // Get the filename from the response headers or use a default
        const contentDisposition = response.headers.get('content-disposition');
        let filename = `font_${fontId}.otf`;
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (filenameMatch && filenameMatch[1]) {
                filename = filenameMatch[1].replace(/['"]/g, '');
            }
        }

        // Create blob and download
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        // Reset button
        downloadBtn.innerHTML = '<span class="icon">✓</span> Downloaded!';
        downloadBtn.style.background = '#27ae60';

        // Reset to original state after 2 seconds
        setTimeout(() => {
            downloadBtn.innerHTML = originalText;
            downloadBtn.disabled = false;
            downloadBtn.style.background = '#27ae60';
        }, 2000);

    } catch (error) {
        console.error('Download error:', error);

        // Reset button and show error
        const downloadBtn = document.querySelector('.download-btn');
        downloadBtn.innerHTML = '<span class="icon">❌</span> Download Failed';
        downloadBtn.style.background = '#e74c3c';
        downloadBtn.disabled = false;

        // Reset to original state after 3 seconds
        setTimeout(() => {
            downloadBtn.innerHTML = '<span class="icon">⬇</span> Download Font';
            downloadBtn.style.background = '#27ae60';
        }, 3000);

        alert(`Download failed: ${error.message}`);
    }
}

// Show login screen
function showLogin() {
    loginScreen.classList.remove('hidden');
    appContainer.classList.add('hidden');
    isAuthenticated = false;
    authStep = 'initial';
    updateLoginUI();
}

// Show main app
function showApp() {
    loginScreen.classList.add('hidden');
    appContainer.classList.remove('hidden');
    isAuthenticated = true;
}

// Handle logout
async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch (error) {
        console.error('Logout error:', error);
    }
    showLogin();
    pageTitle.textContent = 'Font Library Dashboard';
    welcomeView.classList.remove('hidden');
    folderView.classList.add('hidden');
    foldersList.innerHTML = '';
    collections = [];
}

// Navigation handling
document.addEventListener('click', (e) => {
    if (e.target.matches('[data-view]')) {
        const view = e.target.dataset.view;

        // Update active nav item
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        e.target.classList.add('active');

        // Update active folder item
        document.querySelectorAll('.folder-item').forEach(item => item.classList.remove('active'));

        if (view === 'home') {
            pageTitle.textContent = 'Font Library Dashboard';
            welcomeView.classList.remove('hidden');
            folderView.classList.add('hidden');
        } else if (view === 'browse') {
            pageTitle.textContent = 'Browse Fonts';
            welcomeView.classList.add('hidden');
            folderView.classList.remove('hidden');
            folderTitle.textContent = 'Browse All Fonts';
            folderDetails.innerHTML = `
                <div class="detail-card">
                    <div class="detail-label">Total Fonts</div>
                    <div class="detail-value">${collections.reduce((sum, col) => sum + (col.fontCount || 0), 0)}</div>
                </div>
                <div class="detail-card">
                    <div class="detail-label">Collections</div>
                    <div class="detail-value">${collections.length}</div>
                </div>
            `;
            folderDescription.innerHTML = '<p class="folder-description-text">Browse through all available fonts in your library.</p>';
        }
    }
});

// Event listeners
loginBtn.addEventListener('click', () => {
    if (authStep === 'error' && loginBtn.textContent.includes('Retry')) {
        // Retry loading collections
        authStep = 'loading';
        updateLoginUI();
        setTimeout(async () => {
            await loadCollections();
        }, 1000);
    } else {
        // Normal login flow
        redirectToLogin();
    }
});
logoutBtn.addEventListener('click', logout);

// Error logout button in sidebar
const errorLogoutBtn = document.getElementById('error-logout-btn');
errorLogoutBtn.addEventListener('click', logout);

// Browse Fonts toggle
const browseFontsLink = document.getElementById('browse-fonts-link');
const fontSearchFormContainer = document.getElementById('font-search-form-container');
browseFontsLink.addEventListener('click', function (e) {
    e.preventDefault();
    if (fontSearchFormContainer.style.display === 'none' || !fontSearchFormContainer.style.display) {
        fontSearchFormContainer.style.display = 'block';
        // Always repopulate filters when showing the form
        populateFontFilters();
        // Show search results if present
        const searchFolder = document.getElementById('search-results-folder');
        if (searchFolder) searchFolder.style.display = '';
        const searchFontsContainer = document.getElementById('search-results-fonts');
        if (searchFontsContainer) searchFontsContainer.style.display = '';
    } else {
        fontSearchFormContainer.style.display = 'none';
        // Remove search results from sidebar
        const searchFolder = document.getElementById('search-results-folder');
        if (searchFolder) searchFolder.remove();
        const searchFontsContainer = document.getElementById('search-results-fonts');
        if (searchFontsContainer) searchFontsContainer.remove();
    }
});

// Font search form submission
const contextualSearchForm = document.getElementById('contextual-search-form');
const fontSearchForm = document.getElementById('font-search-form');
// Pagination state
let currentPage = 1;
const pageSize = 20;
let totalFonts = 0;
let totalPages = 1;

async function renderContextualSearchResults() {
    const query = document.getElementById('query').value.trim();
    try {
        const payload = {
            query: query
        };
        const response = await fetch('/api/proxy/v1/fontgpt/recommendations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Split on SSE message boundary
            const parts = buffer.split('\n\n');
            buffer = parts.pop(); // keep the last partial chunk

            for (const part of parts) {
                if (part.startsWith('data:')) {
                    const data = part.slice(5).trim();

                    // infoDiv.innerHTML += "<pre>" + JSON.stringify(JSON.parse(data), null, 4) + "</pre>";
                    if (data === '[DONE]') {
                        console.log('Stream complete');
                        break;
                    }
                    try {
                        const obj = JSON.parse(data);
                        // TODO: Update your UI incrementally here
                        if (typeof obj.progress === 'number') {
                            const progressBar = document.getElementById('contextual-search-progress-bar');
                            const progressContainer = document.getElementById('contextual-search-progress');
                            progressContainer.style.display = 'block';
                            progressBar.style.width = `${obj.progress}%`;
                        }
                        if (obj.status === "complete") {
                            const results = { pageNumber: 1, pageSize: obj.results.recommendations.length, itemCount: obj.results.recommendations.length, total: obj.results.recommendations.length, fonts: obj.results.recommendations };
                            console.log('Stream complete signal received', results);
                            await renderSearchResults(1, results);
                            // Hide progress animation after results are rendered
                            document.getElementById('contextual-search-progress').style.display = 'none';
                        }
                    } catch {
                    }
                }
            }
        }
    }
    catch (error) {
        console.error('Error performing contextual search:', error);
    }
}
async function getSearchResults(pageNum) {
    // Get selected values from multi-selects
    function getSelectedValues(select) {
        return Array.from(select.selectedOptions).map(opt => opt.value).filter(Boolean);
    }
    const name = document.getElementById('font-name').value.trim();
    const classificationArr = getSelectedValues(document.getElementById('font-classification'));
    const tagArr = getSelectedValues(document.getElementById('font-tags'));
    const languageArr = getSelectedValues(document.getElementById('font-languages'));
    // Build payload
    const payload = {
        pageSize,
        pageNumber: pageNum
    };
    if (name) payload.name = name;
    if (tagArr.length) payload.tag = tagArr;
    if (classificationArr.length) payload.classification = classificationArr;
    if (languageArr.length) payload.languages = languageArr;
    if (name) {
        payload.searchSettings = { partial: ["name"] };
    }
    try {
        const response = await fetch('/api/proxy/v1/fonts/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        await renderSearchResults(pageNum, result);
    }
    catch (error) {
        console.error('Error fetching search results:', error);
    }
}
// Helper to render search results for a given page
// TODO: does this need to be async?
async function renderSearchResults(pageNum, result) {
    console.log("Rendering search results:", result);
    try {
        // Display search results as a folder in the collections section
        const foldersList = document.getElementById('folders-list');
        // Remove previous search results folder if present
        const prevSearchFolder = document.getElementById('search-results-folder');
        if (prevSearchFolder) prevSearchFolder.remove();
        const prevSearchFontsContainer = document.getElementById('search-results-fonts');
        if (prevSearchFontsContainer) prevSearchFontsContainer.remove();
        // Create search results folder
        const searchFolder = document.createElement('div');
        searchFolder.className = 'folder-item has-children';
        searchFolder.id = 'search-results-folder';
        // Use correct pagination info from API response
        const currentApiPage = result.pageNumber || pageNum;
        const apiPageSize = result.pageSize || pageSize;
        const apiItemCount = result.itemCount || (result.fonts ? result.fonts.length : 0);
        const apiTotal = result.total || apiItemCount;
        totalFonts = apiTotal;
        totalPages = Math.max(1, Math.ceil(apiTotal / apiPageSize));
        searchFolder.innerHTML = `<span><span class="folder-expand-icon expanded">▶</span>🔍 Search Results</span><span class="folder-count">${apiTotal}</span>`;
        foldersList.prepend(searchFolder);
        // Create container for font links
        const searchFontsContainer = document.createElement('div');
        searchFontsContainer.className = 'sub-folders expanded';
        searchFontsContainer.id = 'search-results-fonts';
        searchFolder.after(searchFontsContainer);
        // Wait for all images to load before setting maxHeight
        // Only set maxHeight to scrollHeight when expanded, never to zero except on collapse
        // When expanded, always set maxHeight to 'none' so it never collapses
        if (searchFontsContainer.classList.contains('expanded')) {
            searchFontsContainer.style.maxHeight = 'none';
        }
        // Create font links for each result
        if (result.fonts && result.fonts.length) {
            result.fonts.forEach((font, idx) => {
                const fontItem = document.createElement('div');
                fontItem.className = 'collection-item font-item';
                fontItem.dataset.assetId = font.fontId || font.id;
                fontItem.dataset.assetType = 'SearchResult';
                const fontLink = document.createElement('div');
                fontLink.className = 'collection-link';
                const fontIcon = document.createElement('span');
                fontIcon.className = 'icon';
                fontIcon.innerHTML = '📝';
                const fontName = document.createElement('span');
                fontName.className = 'name';
                fontName.innerHTML = font.name || font.friendlyName || `Font ${idx + 1}`; // Changed from textContent to innerHTML
                fontLink.appendChild(fontIcon);
                fontLink.appendChild(fontName);
                fontItem.appendChild(fontLink);
                fontLink.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Remove selection from other fonts
                    foldersList.querySelectorAll('.font-item').forEach(item => {
                        item.classList.remove('selected');
                    });
                    fontItem.classList.add('selected');
                    const fontId = font.fontId || font.id;
                    await showFontDetails(fontId, font.name || font.friendlyName);
                });
                searchFontsContainer.appendChild(fontItem);
            });
        } else {
            // Show a message if no results
            const noResults = document.createElement('div');
            noResults.className = 'search-results-message';
            noResults.innerHTML = 'No fonts found.';
            searchFontsContainer.appendChild(noResults);
        }
        // Pagination controls (always visible)
        const paginationContainer = document.createElement('div');
        paginationContainer.className = 'pagination-container';
        // Previous button
        const prevBtn = document.createElement('button');
        prevBtn.className = 'pagination-button';
        prevBtn.textContent = 'Previous';
        prevBtn.disabled = currentApiPage === 1;
        prevBtn.onclick = () => {
            if (currentApiPage > 1) {
                currentPage = currentApiPage - 1;
                getSearchResults(currentPage);
            }
        };
        // Next button
        const nextBtn = document.createElement('button');
        nextBtn.className = 'pagination-button';
        nextBtn.textContent = 'Next';
        nextBtn.disabled = currentApiPage === totalPages;
        nextBtn.onclick = () => {
            if (currentApiPage < totalPages) {
                currentPage = currentApiPage + 1;
                getSearchResults(currentPage);
            }
        };
        // Page info
        const pageInfo = document.createElement('span');
        pageInfo.className = 'pagination-info';
        pageInfo.textContent = `Page ${currentApiPage} of ${totalPages}`;
        paginationContainer.appendChild(prevBtn);
        paginationContainer.appendChild(pageInfo);
        paginationContainer.appendChild(nextBtn);
        searchFontsContainer.appendChild(paginationContainer);
        // Expand/collapse logic for search results folder
        searchFolder.addEventListener('click', function (e) {
            e.stopPropagation();
            const expandIcon = searchFolder.querySelector('.folder-expand-icon');
            const isExpanded = searchFontsContainer.classList.contains('expanded');
            if (isExpanded) {
                searchFontsContainer.classList.remove('expanded');
                expandIcon.classList.remove('expanded');
                searchFontsContainer.style.maxHeight = '0';
            } else {
                searchFontsContainer.classList.add('expanded');
                expandIcon.classList.add('expanded');
                searchFontsContainer.style.maxHeight = searchFontsContainer.scrollHeight + 'px';
            }
        });
    } catch (err) {
        alert('Font search failed: ' + err.message);
    }
}
// Initial render
fontSearchForm.addEventListener('submit', function (e) {
    e.preventDefault();
    currentPage = 1;
    getSearchResults(currentPage);
});
contextualSearchForm.addEventListener('submit', function (e) {
    e.preventDefault();
    currentPage = 1;
    renderContextualSearchResults();
});

// Add this after DOMContentLoaded or at the end of your script
async function populateFontFilters() {
    try {
        const response = await fetch('/api/proxy/v1/fonts/filterslookup?lookup=classification&lookup=language&lookup=tags', {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        const result = await response.json();
        // Populate dropdowns
        const classificationSelect = document.getElementById('font-classification');
        const tagsSelect = document.getElementById('font-tags');
        const languagesSelect = document.getElementById('font-languages');
        const searchBtn = document.getElementById('font-search-btn');
        const contextualSearchBtn = document.getElementById('contextual-search-btn');
        // Show loading state
        classificationSelect.innerHTML = '<option>Loading...</option>';
        tagsSelect.innerHTML = '<option>Loading...</option>';
        languagesSelect.innerHTML = '<option>Loading...</option>';
        searchBtn.disabled = true;
        contextualSearchBtn.disabled = true;
        let loadedCount = 0;
        // Populate dropdowns using correct keys from API response
        if (result.classification && Array.isArray(result.classification)) {
            classificationSelect.innerHTML = '<option value="">Any</option>' + result.classification.map(c => `<option value="${c}">${c}</option>`).join('');
            loadedCount++;
        }
        if (result.tags && Array.isArray(result.tags)) {
            tagsSelect.innerHTML = '<option value="">Any</option>' + result.tags.map(t => `<option value="${t}">${t}</option>`).join('');
            loadedCount++;
        }
        if (result.language && Array.isArray(result.language)) {
            languagesSelect.innerHTML = '<option value="">Any</option>' + result.language.map(l => `<option value="${l}">${l}</option>`).join('');
            loadedCount++;
        }
        // Enable search button only if all dropdowns are loaded
        if (loadedCount === 3) {
            searchBtn.disabled = false;
            contextualSearchBtn.disabled = false;
        }
    } catch (err) {
        console.error('Failed to load font filters:', err);
    }
}

// Main initialization
async function main() {
    const { code } = getQueryParams();
    if (code) {
        // User returned from OAuth provider
        await exchangeCodeForTokens(code);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        // Check if already authenticated
        try {
            authStep = 'loading';
            updateLoginUI();
            const response = await fetch('/api/session');
            const sessionData = await response.json();
            if (sessionData.authenticated && sessionData.hasValidTokens) {
                isAuthenticated = true;
                showStatus('Existing session found. Loading your collections...', 'info');
                await loadCollections();
            } else {
                authStep = 'initial';
                updateLoginUI();
                showLogin();
            }
        } catch (error) {
            console.error('Session check failed:', error);
            authStep = 'initial';
            updateLoginUI();
            showLogin();
        }
    }
}
// Start the application
main();
