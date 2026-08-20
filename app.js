const AUTH0_REDIRECT_URI = window.location.origin + window.location.pathname;
let isAuthenticated = false;
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

function createTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = String(text ?? '');
    return element;
}

function appendDetailCard(container, label, value, extraClass = '') {
    const card = document.createElement('div');
    card.className = `detail-card${extraClass ? ` ${extraClass}` : ''}`;
    card.appendChild(createTextElement('div', 'detail-label', label));
    card.appendChild(createTextElement('div', 'detail-value', value));
    container.appendChild(card);
    return card;
}

function appendFontMetadata(label, value, { fullWidth = false, valueClass = '' } = {}) {
    const metadata = document.createElement('div');
    metadata.className = `font-metadata${fullWidth ? ' full-width' : ''}`;
    metadata.appendChild(createTextElement('div', 'detail-label', label));
    metadata.appendChild(createTextElement('div', `detail-value${valueClass ? ` ${valueClass}` : ''}`, value));
    fontDetails.appendChild(metadata);
    return metadata;
}

function showFontError(message) {
    fontDetails.replaceChildren();
    appendDetailCard(fontDetails, 'Error', `Failed to load font details: ${message}`, 'detail-card-error');
}

function setDownloadButtonContent(button, icon, label) {
    button.replaceChildren(
        createTextElement('span', 'icon', icon),
        document.createTextNode(` ${label}`)
    );
}

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

    foldersList.replaceChildren();

    ['personal', 'shared'].forEach(accessType => {
        const treeItems = collectionTrees[accessType] || [];
        const tree = document.createElement('section');
        tree.className = 'collection-tree';
        tree.classList.toggle('hidden', !libraryTreesVisible);

        const heading = document.createElement('div');
        heading.className = 'collection-tree-heading';
        heading.appendChild(createTextElement('span', '', accessType === 'personal' ? 'Personal' : 'Shared'));
        heading.appendChild(createTextElement('span', '', treeItems.length));
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
    fontIcon.textContent = '📝'; // Font icon

    const fontName = document.createElement('span');
    fontName.className = 'name';
    fontName.textContent = font.name || font.displayName || `Font ${index + 1}`;

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

    const countClass = isSubItem ? 'sub-folder-count' : 'folder-count';

    const itemLabel = document.createElement('span');
    if (hasSubItems) {
        itemLabel.appendChild(createTextElement('span', 'folder-expand-icon', '▶'));
    }
    itemLabel.appendChild(document.createTextNode(`${icon} ${collectionName}`));
    folderItem.appendChild(itemLabel);
    if (childCount !== null) {
        folderItem.appendChild(createTextElement('span', countClass, childCount));
    }

    // Add click handler
    folderItem.addEventListener('click', async (e) => {
        e.stopPropagation();

        if (hasSubItems) {
            const toggled = await toggleSubFolders(itemContainer, collection);
            if (!toggled) return;
        }

        showCollection(collection);
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
    container.replaceChildren();
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
                    return false;
                } finally {
                    folderItem?.classList.remove('loading');
                }
            }
            subFoldersContainer.classList.add('expanded');
            expandIcon.classList.add('expanded');
        }
        return true;
    }
    return false;
}

// Show collection details
function showCollection(collection) {
    const collectionName = collection.name || collection.displayName || 'Unnamed collection';
    const collectionId = collection.id || collection.assetId || 'Unknown';
    const assetType = collection.assetType || 'Unknown';
    const childCount = getDisplayedChildCount(collection);
    const displayedChildCount = childCount === null ? 'Unknown' : childCount;

    pageTitle.textContent = `Collection: ${collectionName}`;
    folderTitle.textContent = collectionName;

    // Update active state for both folder-item and sub-folder-item
    document.querySelectorAll('.folder-item, .sub-folder-item').forEach(item => item.classList.remove('active'));
    const activeItem = Array.from(document.querySelectorAll('.folder-item, .sub-folder-item'))
        .find(item => item.dataset.collectionId === String(collectionId));
    if (activeItem) {
        activeItem.classList.add('active');
    }

    // Show folder view
    welcomeView.classList.add('hidden');
    fontView.classList.add('hidden');
    folderView.classList.remove('hidden');

    folderDetails.replaceChildren();
    appendDetailCard(folderDetails, 'Collection ID', collectionId);
    appendDetailCard(folderDetails, 'Asset Type', assetType);
    appendDetailCard(folderDetails, 'Child Count', displayedChildCount);

    // Generate description based on asset type and contents
    let description = '';
    if (assetType === 'Folder') {
        const fontSets = collection.children ? collection.children.filter(c => c.assetType === 'FontSet').length : 0;
        description = childCount === null
            ? 'Open this folder to load its contents.'
            : `This folder contains ${displayedChildCount} immediate item(s), including ${fontSets} font set(s).`;
    } else if (assetType === 'FontSet') {
        description = childCount === null
            ? 'Open this font set to load its contents.'
            : `This font set contains ${displayedChildCount} immediate item(s).`;
    } else if (assetType === 'WebProject') {
        description = `This is a web project collection.`;
    } else {
        description = `Collection of type "${assetType}".`;
    }

    folderDescription.replaceChildren(createTextElement('p', 'folder-description-text', description));
}

// Show font details
async function showFontDetails(fontAssetId, fontName) {
    try {
        const displayedFontName = fontName || 'Unknown font';
        pageTitle.textContent = `Font: ${displayedFontName}`;
        fontTitle.textContent = displayedFontName;

        // Hide other views and show font view
        welcomeView.classList.add('hidden');
        folderView.classList.add('hidden');
        fontView.classList.remove('hidden');

        requestAnimationFrame(() => {
            fontView.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });

        // Show loading state
        fontLoading.classList.remove('hidden');
        fontDetails.replaceChildren();

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
            showFontError(result.message || response.statusText);
        }
    } catch (error) {
        console.error('Error fetching font details:', error);
        fontLoading.classList.add('hidden');
        showFontError(error.message);
    }
}

// Render font details
function renderFontDetails(fontData) {
    fontDetails.replaceChildren();

    if (fontData.sample) {
        const sample = document.createElement('div');
        sample.className = 'font-sample';
        sample.appendChild(createTextElement('div', 'detail-label', 'Official Font Sample'));
        const sampleImage = document.createElement('img');
        sampleImage.className = 'font-sample-image';
        sampleImage.src = fontData.sample;
        sampleImage.alt = `Font sample for ${fontData.friendlyName || fontData.name || 'selected font'}`;
        sampleImage.addEventListener('error', () => {
            sample.remove();
        }, { once: true });
        sample.appendChild(sampleImage);
        fontDetails.appendChild(sample);
    }

    const downloadSection = document.createElement('div');
    downloadSection.className = 'font-download-section';
    const downloadButton = document.createElement('button');
    downloadButton.className = 'download-btn';
    downloadButton.type = 'button';
    downloadButton.appendChild(createTextElement('span', 'icon', '⬇'));
    downloadButton.appendChild(document.createTextNode(' Download Font'));
    const fontId = fontData.fontId || fontData.id;
    downloadButton.addEventListener('click', () => downloadFont(fontId));
    downloadSection.appendChild(downloadButton);
    fontDetails.appendChild(downloadSection);

    const metadataFields = [
        ['Font Name', fontData.friendlyName || fontData.name || 'Unknown'],
        ['PostScript Name', fontData.psName || 'Unknown'],
        ['Font ID', fontData.fontId || fontData.id || 'Unknown'],
        ['Font Family', fontData.family || 'Unknown'],
        ['Style', fontData.style || 'Unknown'],
        ['Weight (CSS)', fontData.weightCSS || 'Unknown'],
        ['Foundry', fontData.foundry || 'Unknown'],
        ['Format', fontData.format || 'Unknown']
    ];
    metadataFields.forEach(([label, value]) => appendFontMetadata(label, value));

    if (fontData.description) {
        appendFontMetadata('Description', fontData.description, { fullWidth: true });
    }

    const tagGroups = [
        ['Classification', fontData.classification, 'classification-tag', ''],
        ['Tags', fontData.tag, 'tag-badge', ''],
        ['Public Tags', fontData.publicTags, 'public-tag', 'public-tags-container']
    ];
    tagGroups.forEach(([label, values, tagClass, containerClass]) => {
        if (!Array.isArray(values) || values.length === 0) return;
        const metadata = appendFontMetadata(label, '', { fullWidth: true, valueClass: containerClass });
        const valueContainer = metadata.querySelector('.detail-value');
        values.forEach(value => valueContainer.appendChild(createTextElement('span', tagClass, value)));
    });
}

// Download font function
async function downloadFont(fontId) {
    if (!fontId) {
        alert('Font ID not available for download');
        return;
    }

    try {
        const downloadBtn = document.querySelector('.download-btn');

        // Update button to show loading state
        setDownloadButtonContent(downloadBtn, '⏳', 'Downloading...');
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
        setDownloadButtonContent(downloadBtn, '✓', 'Downloaded!');
        downloadBtn.style.background = '#27ae60';

        // Reset to original state after 2 seconds
        setTimeout(() => {
            setDownloadButtonContent(downloadBtn, '⬇', 'Download Font');
            downloadBtn.disabled = false;
            downloadBtn.style.background = '#27ae60';
        }, 2000);

    } catch (error) {
        console.error('Download error:', error);

        // Reset button and show error
        const downloadBtn = document.querySelector('.download-btn');
        setDownloadButtonContent(downloadBtn, '❌', 'Download Failed');
        downloadBtn.style.background = '#e74c3c';
        downloadBtn.disabled = false;

        // Reset to original state after 3 seconds
        setTimeout(() => {
            setDownloadButtonContent(downloadBtn, '⬇', 'Download Font');
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
    foldersList.replaceChildren();
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
            folderDetails.replaceChildren();
            appendDetailCard(folderDetails, 'Personal Top-Level Assets', collectionTrees.personal.length);
            appendDetailCard(folderDetails, 'Shared Top-Level Assets', collectionTrees.shared.length);
            folderDescription.replaceChildren(
                createTextElement('p', 'folder-description-text', 'Discover available fonts in your library.')
            );
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
    document.getElementById('contextual-search-activity').replaceChildren();
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
        const currentApiPage = Number(result.pageNumber) || pageNum;
        const apiPageSize = Number(result.pageSize) || pageSize;
        const apiItemCount = Number(result.itemCount ?? result.fonts?.length ?? 0) || 0;
        const apiTotal = Number(result.total ?? apiItemCount) || 0;
        totalPages = Math.max(1, Math.ceil(apiTotal / apiPageSize));
        const searchFolderLabel = document.createElement('span');
        searchFolderLabel.appendChild(createTextElement('span', 'folder-expand-icon expanded', '▶'));
        searchFolderLabel.appendChild(document.createTextNode('🔍 Search Results'));
        searchFolder.appendChild(searchFolderLabel);
        searchFolder.appendChild(createTextElement('span', 'folder-count', apiTotal));
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
                fontIcon.textContent = '📝';
                const fontName = document.createElement('span');
                fontName.className = 'name';
                fontName.textContent = font.name || font.friendlyName || `Font ${idx + 1}`;
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
            noResults.textContent = 'No fonts found.';
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
        prevBtn.addEventListener('click', () => {
            if (currentApiPage > 1) {
                currentPage = currentApiPage - 1;
                getSearchResults(currentPage);
            }
        });
        // Next button
        const nextBtn = document.createElement('button');
        nextBtn.className = 'pagination-button';
        nextBtn.textContent = 'Next';
        nextBtn.disabled = currentApiPage === totalPages;
        nextBtn.addEventListener('click', () => {
            if (currentApiPage < totalPages) {
                currentPage = currentApiPage + 1;
                getSearchResults(currentPage);
            }
        });
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

function setSelectOptions(select, values, firstLabel = 'Any') {
    select.replaceChildren();
    const firstOption = createTextElement('option', '', firstLabel);
    firstOption.value = '';
    select.appendChild(firstOption);
    values.forEach(value => {
        const option = createTextElement('option', '', value);
        option.value = String(value);
        select.appendChild(option);
    });
}

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
        setSelectOptions(classificationSelect, [], 'Loading...');
        setSelectOptions(tagsSelect, [], 'Loading...');
        setSelectOptions(languagesSelect, [], 'Loading...');
        searchBtn.disabled = true;
        contextualSearchBtn.disabled = true;
        let loadedCount = 0;
        // Populate dropdowns using correct keys from API response
        if (result.classification && Array.isArray(result.classification)) {
            setSelectOptions(classificationSelect, result.classification);
            loadedCount++;
        }
        if (result.tags && Array.isArray(result.tags)) {
            setSelectOptions(tagsSelect, result.tags);
            loadedCount++;
        }
        if (result.language && Array.isArray(result.language)) {
            setSelectOptions(languagesSelect, result.language);
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
