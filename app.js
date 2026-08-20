const AUTH0_REDIRECT_URI = window.location.origin + window.location.pathname;
let isAuthenticated = false;
let collections = [];
let collectionTrees = { personal: [], shared: [] };
let libraryTreesVisible = false;
let browseFontsVisible = false;
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
}

function parseCollectionPage(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result.data)) return result.data;
    if (Array.isArray(result.items)) return result.items;
    if (Array.isArray(result.assets)) return result.assets;
    throw new Error('Unexpected collections response structure.');
}

async function fetchCollectionPages(accessType, parentAsset = null) {
    const pageSize = parentAsset ? 25 : 100;
    const allItems = [];
    let pageNumber = 1;
    let hasMorePages = true;

    while (hasMorePages) {
        const query = new URLSearchParams({
            pageNumber: String(pageNumber),
            pageSize: String(pageSize),
            accessType
        });

        if (parentAsset) {
            query.set('assetType', parentAsset.assetType);
            query.set('assetId', parentAsset.id || parentAsset.assetId);
        } else {
            query.set('sortBy', 'name');
            query.set('sortOrder', 'asc');
        }

        const collectionsUrl = `/api/proxy/v1/fontslibrary/collections-lite?${query}`;
        console.log('Making request to', collectionsUrl);

        const response = await fetch(collectionsUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        const result = await response.json();

        console.log(`Collections page ${pageNumber} status:`, response.status);
        console.log(`Collections page ${pageNumber} response:`, result);

        if (response.status === 429) {
            throw new Error('Rate limit exceeded. Please wait a moment and try again.');
        }
        if (!response.ok) {
            const errorTitle = result.error?.title || result.error;
            if (errorTitle === 'Not authenticated' || errorTitle === 'AUTHENTICATION_FAILED') {
                throw new Error('Session expired. Please log in again.');
            }
            throw new Error(result.message || result.error?.detail || `HTTP ${response.status}: Failed to load collections`);
        }

        const pageItems = parseCollectionPage(result).map(item => ({
            ...item,
            accessType,
            _childrenLoaded: false
        }));
        allItems.push(...pageItems);

        const totalPages = result.totalPages
            ?? result.pagination?.totalPages
            ?? result.meta?.totalPages;
        hasMorePages = Number.isInteger(totalPages)
            ? pageNumber < totalPages
            : pageItems.length === pageSize;
        pageNumber += 1;
    }

    return allItems;
}

// Load the personal and shared collection trees from the API.
async function loadCollections() {
    try {
        foldersLoading.classList.remove('hidden');
        foldersError.classList.add('hidden');
        foldersList.classList.add('hidden');

        collectionTrees = {
            personal: await fetchCollectionPages('personal'),
            shared: await fetchCollectionPages('shared')
        };
        collections = [...collectionTrees.personal, ...collectionTrees.shared];

        console.log('Parsed collection trees:', collectionTrees);
        renderCollections();

        authStep = 'ready';
        showApp();
        showStatus('Successfully connected to your font library!', 'success');
        setTimeout(hideStatus, 3000);
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

    ['personal', 'shared'].forEach(accessType => {
        const treeItems = collectionTrees[accessType] || [];
        const tree = document.createElement('section');
        tree.className = 'collection-tree';
        tree.classList.toggle('hidden', !libraryTreesVisible);

        const heading = document.createElement('div');
        heading.className = 'collection-tree-heading';
        heading.innerHTML = `<span>${accessType === 'personal' ? 'Personal' : 'Shared'}</span><span>${treeItems.length}</span>`;
        tree.appendChild(heading);

        if (treeItems.length === 0) {
            const emptyItem = document.createElement('div');
            emptyItem.className = 'collection-tree-empty';
            emptyItem.textContent = `No ${accessType} collections found`;
            tree.appendChild(emptyItem);
        } else {
            treeItems.forEach((collection, index) => {
                renderCollectionItem(collection, index, tree, false);
            });
        }

        foldersList.appendChild(tree);
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

        // Only one font may be selected anywhere in the sidebar.
        document.querySelector('.sidebar-nav').querySelectorAll('.font-item').forEach(item => {
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

function getDisplayedChildCount(collection) {
    if (!collection._childrenLoaded) {
        return collection.itemCount ?? null;
    }
    return collection.children?.length ?? 0;
}

function renderCollectionItem(collection, index, parentElement, isSubItem = false) {
    const collectionId = collection.id || collection.assetId;
    const collectionName = collection.name || collection.displayName || `Collection ${index + 1}`;
    const assetType = collection.assetType;
    const expandableTypes = ['Folder', 'FontSet', 'WebProject', 'DigitalAd'];
    const hasSubItems = expandableTypes.includes(assetType) && collection.itemCount !== 0;
    const childCount = getDisplayedChildCount(collection);

    // Choose appropriate icon based on asset type
    let icon = '📁';
    if (assetType === 'FontSet') icon = '🔤';
    else if (assetType === 'WebProject') icon = '🌐';
    else if (assetType === 'DigitalAd') icon = '📣';

    // Create the main item container
    const itemContainer = document.createElement('div');

    // Create the folder item
    const folderItem = document.createElement('div');
    folderItem.className = isSubItem ? 'sub-folder-item' : 'folder-item';
    if (hasSubItems) {
        folderItem.classList.add('has-children');
    }

    folderItem.dataset.collectionId = collectionId;

    const expandIcon = hasSubItems ? '<span class="folder-expand-icon">▶</span>' : '';
    const countClass = isSubItem ? 'sub-folder-count' : 'folder-count';

    folderItem.innerHTML = `
        <span>${expandIcon}${icon} ${collectionName}</span>
        ${childCount === null ? '' : `<span class="${countClass}">${childCount}</span>`}
    `;

    // Add click handler
    folderItem.addEventListener('click', async (e) => {
        e.stopPropagation();

        if (hasSubItems) {
            await toggleSubFolders(itemContainer, collection);
        }

        // Show collection details
        showCollection({
            id: collectionId,
            name: collectionName,
            assetType: assetType,
            fontCount: getDisplayedChildCount(collection),
            children: collection.children,
            ...collection
        });
    });

    itemContainer.appendChild(folderItem);

    // Child assets are loaded on the first expansion.
    if (hasSubItems) {
        const subFoldersContainer = document.createElement('div');
        subFoldersContainer.className = 'sub-folders';
        subFoldersContainer.dataset.parentId = collectionId;
        if (collection._childrenLoaded) {
            renderCollectionChildren(collection, subFoldersContainer);
        }
        itemContainer.appendChild(subFoldersContainer);
    }

    parentElement.appendChild(itemContainer);
}

function renderCollectionChildren(collection, container) {
    container.innerHTML = '';
    const children = collection.children || [];

    if (children.length === 0) {
        const emptyItem = document.createElement('div');
        emptyItem.className = 'collection-tree-empty';
        emptyItem.textContent = 'No items found';
        container.appendChild(emptyItem);
        return;
    }

    children.forEach((child, childIndex) => {
        if (['Folder', 'FontSet', 'WebProject', 'DigitalAd'].includes(child.assetType)) {
            renderCollectionItem(child, childIndex, container, true);
        } else if (child.assetType === 'Variation' || child.assetType === 'Font') {
            container.classList.add('has-fonts');
            renderFontItem(child, childIndex, container, collection);
        }
    });
}

// Load child assets on demand, then toggle their visibility.
async function toggleSubFolders(container, collection) {
    const subFoldersContainer = container.querySelector('.sub-folders');
    const expandIcon = container.querySelector('.folder-expand-icon');

    if (subFoldersContainer && expandIcon) {
        const isExpanded = subFoldersContainer.classList.contains('expanded');

        if (isExpanded) {
            subFoldersContainer.classList.remove('expanded');
            expandIcon.classList.remove('expanded');
        } else {
            if (!collection._childrenLoaded) {
                const folderItem = container.querySelector('.folder-item, .sub-folder-item');
                folderItem?.classList.add('loading');
                try {
                    collection.children = await fetchCollectionPages(collection.accessType, collection);
                    collection._childrenLoaded = true;
                    renderCollectionChildren(collection, subFoldersContainer);

                    let count = folderItem?.querySelector('.folder-count, .sub-folder-count');
                    if (!count && folderItem) {
                        count = document.createElement('span');
                        count.className = folderItem.classList.contains('sub-folder-item')
                            ? 'sub-folder-count'
                            : 'folder-count';
                        folderItem.appendChild(count);
                    }
                    if (count) count.textContent = String(collection.children.length);
                } catch (error) {
                    console.error(`Failed to load ${collection.name} contents:`, error);
                    showStatus(`Failed to load ${collection.name} contents: ${error.message}`, 'error');
                    return;
                } finally {
                    folderItem?.classList.remove('loading');
                }
            }
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

        requestAnimationFrame(() => {
            fontView.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });

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
            <img class="font-sample-image" alt="" />
        </div>
        ` : ''}
        
        <div class="font-download-section">
            <button class="download-btn" type="button">
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

    const sampleImage = fontDetails.querySelector('.font-sample-image');
    if (sampleImage) {
        sampleImage.src = fontData.sample;
        sampleImage.alt = `Font sample for ${fontData.friendlyName || fontData.name || 'selected font'}`;
        sampleImage.addEventListener('error', () => {
            sampleImage.closest('.font-sample')?.remove();
        }, { once: true });
    }

    const downloadButton = fontDetails.querySelector('.download-btn');
    if (downloadButton) {
        const fontId = fontData.fontId || fontData.id;
        downloadButton.addEventListener('click', () => downloadFont(fontId));
    }
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

function setLibraryTreesVisible(visible) {
    libraryTreesVisible = visible;
    foldersList.querySelectorAll('.collection-tree').forEach(tree => {
        tree.classList.toggle('hidden', !visible);
    });
    document.querySelector('[data-view="library"]')?.setAttribute('aria-expanded', String(visible));
}

function setBrowseFontsVisible(visible) {
    browseFontsVisible = visible;
    const searchForm = document.getElementById('font-search-form-container');
    const searchResults = document.getElementById('search-results-list');
    searchForm.style.display = visible ? 'block' : 'none';
    searchResults.classList.toggle('hidden', !visible);
    document.querySelector('[data-view="browse"]')?.setAttribute('aria-expanded', String(visible));
    if (visible) populateFontFilters();
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
    collectionTrees = { personal: [], shared: [] };
    setLibraryTreesVisible(false);
    setBrowseFontsVisible(false);
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.querySelector('[data-view="home"]')?.classList.add('active');
}

// Navigation handling
document.addEventListener('click', (e) => {
    const navItem = e.target.closest('.nav-item[data-view]');
    if (navItem) {
        const view = navItem.dataset.view;

        if (navItem.classList.contains('active')) {
            if (view === 'library') {
                setLibraryTreesVisible(false);
                navItem.classList.remove('active');
            } else if (view === 'browse') {
                setBrowseFontsVisible(false);
                navItem.classList.remove('active');
            }
            return;
        }

        if (view === 'home') {
            setLibraryTreesVisible(false);
            setBrowseFontsVisible(false);
        } else if (view === 'library') {
            setLibraryTreesVisible(true);
            setBrowseFontsVisible(false);
        } else if (view === 'browse') {
            setBrowseFontsVisible(true);
            setLibraryTreesVisible(false);
        }

        // Update active nav item
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        navItem.classList.add('active');

        // Update active folder item
        document.querySelectorAll('.folder-item').forEach(item => item.classList.remove('active'));

        if (view === 'home') {
            pageTitle.textContent = 'Font Library Dashboard';
            welcomeView.classList.remove('hidden');
            folderView.classList.add('hidden');
            fontView.classList.add('hidden');
        } else if (view === 'browse') {
            pageTitle.textContent = 'Discover Fonts';
            welcomeView.classList.add('hidden');
            folderView.classList.remove('hidden');
            fontView.classList.add('hidden');
            folderTitle.textContent = 'Discover Fonts';
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
            folderDescription.innerHTML = '<p class="folder-description-text">Discover available fonts in your library.</p>';
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

// Font search form submission
const contextualSearchForm = document.getElementById('contextual-search-form');
const fontSearchForm = document.getElementById('font-search-form');
// Pagination state
let currentPage = 1;
const pageSize = 20;
let totalFonts = 0;
let totalPages = 1;

function formatApiFieldName(name) {
    return name
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/^./, character => character.toUpperCase());
}

function appendContextualSearchActivity(text) {
    if (!text) return;
    const activity = document.getElementById('contextual-search-activity');
    const lastItem = activity.lastElementChild;
    if (lastItem?.textContent === text) return;

    const item = document.createElement('div');
    item.className = 'contextual-search-activity-item';
    item.textContent = text;
    activity.appendChild(item);

    while (activity.children.length > 4) {
        activity.firstElementChild.remove();
    }
}

function updateContextualSearchProgress(apiResponse) {
    const progressContainer = document.getElementById('contextual-search-progress');
    const progressBar = document.getElementById('contextual-search-progress-bar');
    const status = document.getElementById('contextual-search-status');
    const percent = document.getElementById('contextual-search-percent');

    progressContainer.style.display = 'block';

    if (typeof apiResponse.progress === 'number') {
        const progress = Math.min(100, Math.max(0, apiResponse.progress));
        progressBar.style.width = `${progress}%`;
        percent.textContent = `${Math.round(progress)}%`;
    }

    const statusText = apiResponse.message
        || apiResponse.detail
        || apiResponse.stage
        || apiResponse.phase
        || apiResponse.step
        || apiResponse.status;
    if (statusText) status.textContent = String(statusText);

    const activityFields = ['stage', 'phase', 'step', 'action', 'message', 'detail'];
    let activityEntries = activityFields
        .filter(key => typeof apiResponse[key] === 'string' && apiResponse[key].trim())
        .map(key => `${formatApiFieldName(key)}: ${apiResponse[key].trim()}`);

    if (activityEntries.length === 0 && typeof apiResponse.status === 'string') {
        activityEntries = [`Status: ${apiResponse.status}`];
    }

    const activityText = [...new Set(activityEntries)]
        .join(' · ');
    appendContextualSearchActivity(activityText);

    if (apiResponse.status === 'complete') {
        progressContainer.classList.add('complete');
        progressBar.style.width = '100%';
        percent.textContent = '100%';
    }
}

function resetContextualSearchProgress() {
    const progressContainer = document.getElementById('contextual-search-progress');
    progressContainer.style.display = 'block';
    progressContainer.classList.remove('complete');
    document.getElementById('contextual-search-progress-bar').style.width = '0%';
    document.getElementById('contextual-search-status').textContent = 'Waiting for API response…';
    document.getElementById('contextual-search-percent').textContent = '0%';
    document.getElementById('contextual-search-activity').innerHTML = '';
}

async function renderContextualSearchResults() {
    const query = document.getElementById('query').value.trim();
    try {
        resetContextualSearchProgress();
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
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Contextual search failed`);
        }
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
                        appendContextualSearchActivity('[DONE]');
                        break;
                    }
                    try {
                        const obj = JSON.parse(data);
                        updateContextualSearchProgress(obj);
                        if (obj.status === "complete") {
                            const recommendations = obj.results?.recommendations || [];
                            const results = { pageNumber: 1, pageSize: recommendations.length, itemCount: recommendations.length, total: recommendations.length, fonts: recommendations };
                            console.log('Stream complete signal received', results);
                            await renderSearchResults(1, results);
                            document.getElementById('contextual-search-progress').style.display = 'none';
                        }
                    } catch (error) {
                        console.warn('Unable to parse contextual search event:', data, error);
                    }
                }
            }
        }
    }
    catch (error) {
        console.error('Error performing contextual search:', error);
        document.getElementById('contextual-search-status').textContent = error.message;
        appendContextualSearchActivity(`Error: ${error.message}`);
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
        const searchResultsList = document.getElementById('search-results-list');
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
        searchResultsList.prepend(searchFolder);
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
                    document.querySelector('.sidebar-nav').querySelectorAll('.font-item').forEach(item => {
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

        requestAnimationFrame(() => {
            searchFolder.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
