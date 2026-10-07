let consoleLog = function (messageText, ...argsL) {
    if (argsL !== undefined && argsL.length > 0)
        console.log("[SaveToAnytype] %c[Back]%c " + messageText + " %c[Params]%c", "color: green; font-weight: bold;", "", "color: blue; font-weight: bold;", "", argsL);
    else
        console.log("[SaveToAnytype] %c[Back]%c " + messageText, "color: green; font-weight: bold;", "");
}

let consoleError = function (messageText, ...argsL) {
    if (argsL !== undefined && argsL.length > 0)
        console.error("[SaveToAnytype] %c[Back]%c " + messageText + " %c[Params]%c", "color: green; font-weight: bold;", "", "color: blue; font-weight: bold;", "", argsL);
    else
        console.error("[SaveToAnytype] %c[Back]%c " + messageText, "color: green; font-weight: bold;", "");
}

// Anytype local API v2 base URL (space-scoped routes: /v2/spaces/{space_id}/...)
const API_BASE_URL_V2 = 'http://localhost:31009/v2';

consoleLog('Background script loading...');

//#region Work with page data

function findLargestVisibleImage() {
    const imgs = Array.from(document.querySelectorAll("img"));

    const isValidImageSource = (source) => {
        if (!source || typeof source !== "string") return false;
        const normalized = source.trim();
        if (!normalized) return false;

        // Only allow regular network image URLs.
        if (!/^https?:\/\//i.test(normalized)) return false;

        // Skip obvious non-image and unsupported image formats for this use case.
        if (normalized.startsWith("data:image/svg+xml") || /\.svg([?#].*)?$/i.test(normalized)) return false;
        if (/\.js([?#].*)?$/i.test(normalized)) return false;

        return /\.(png|jpe?g|webp|gif|bmp|avif)([?#].*)?$/i.test(normalized) || /^https?:\/\//i.test(normalized);
    };

    let bestVisibleSource = "";
    let bestVisibleArea = 0;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    imgs.forEach((img) => {
        const imageSource = img.currentSrc || img.src || "";
        if (!isValidImageSource(imageSource)) return;

        // Only use actual loaded image elements.
        if (img.naturalWidth <= 1 || img.naturalHeight <= 1) return;

        const rect = img.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        // Strictly visible on screen: element must intersect viewport.
        const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
        const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        if (visibleWidth <= 0 || visibleHeight <= 0) return;

        const renderedVisibleArea = visibleWidth * visibleHeight;

        const style = window.getComputedStyle(img);
        if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            parseFloat(style.opacity) === 0
        ) return;

        // Verify visibility at the center of visible region (not just element center).
        const visibleCenterX = Math.max(0, Math.min(viewportWidth, Math.max(rect.left, 0) + visibleWidth / 2));
        const visibleCenterY = Math.max(0, Math.min(viewportHeight, Math.max(rect.top, 0) + visibleHeight / 2));
        let topElement = document.elementFromPoint(visibleCenterX, visibleCenterY);

        // Ignore our own overlay when checking if image is occluded.
        if (topElement?.id === "save-to-anytype-overlay" || topElement?.closest?.("#save-to-anytype-overlay")) {
            const overlay = document.getElementById("save-to-anytype-overlay");
            if (overlay) {
                const prevPointerEvents = overlay.style.pointerEvents;
                overlay.style.pointerEvents = "none";
                topElement = document.elementFromPoint(visibleCenterX, visibleCenterY);
                overlay.style.pointerEvents = prevPointerEvents;
            }
        }

        if (topElement && !img.contains(topElement) && topElement !== img) return;

        if (renderedVisibleArea > bestVisibleArea) {
            bestVisibleArea = renderedVisibleArea;
            bestVisibleSource = imageSource;
        }
    });

    return bestVisibleSource || "";
}

function findDescription() {
    // 1. meta description
    let el = document.querySelector('meta[name="description"]');
    if (el?.content?.trim()) return el.content.trim();

    // 2. og:description
    el = document.querySelector('meta[property="og:description"]');
    if (el?.content?.trim()) return el.content.trim();

    // 3. twitter:description
    el = document.querySelector('meta[name="twitter:description"]');
    if (el?.content?.trim()) return el.content.trim();

    // 4. first meaningful <p>
    const p = Array.from(document.querySelectorAll("p"))
        .map(p => p.innerText.trim())
        .find(text => text.length > 30 && text.length < 100);
    if (p) return p;

    // 5. title
    if (document.title?.trim()) return document.title.trim();

    // 6. fallback
    return '';
}

// Web clipping

function extractPageText() {
    try {
        if (!document || !document.body) {
            throw new Error('Document body not found');
        }

        if (typeof Defuddle === 'undefined') {
            throw new Error('Defuddle is not loaded');
        }

        const documentClone = document.cloneNode(true);
        const result = new Defuddle(documentClone).parse();

        if (!result || !result.content) {
            throw new Error('Defuddle could not parse the page');
        }

        return result.content;

    } catch (error) {
        console.error("Content Extraction Error: ", error);
        return "PAGE PARSE ERROR";
    }
}

function extractChatText() {
    try {
        const hostname = window.location.hostname.toLowerCase();
        let markdown = "";
        
        if (hostname.includes("chatgpt.com")) {
            const messages = document.querySelectorAll('[data-message-author-role]');
            messages.forEach(msg => {
                const role = msg.getAttribute('data-message-author-role');
                const text = msg.innerText;
                markdown += `**${role.charAt(0).toUpperCase() + role.slice(1)}:**\n${text}\n\n`;
            });
        } else if (hostname.includes("gemini.google.com")) {
            const userQueries = document.querySelectorAll('user-query');
            const modelResponses = document.querySelectorAll('model-response');
            const maxLen = Math.max(userQueries.length, modelResponses.length);
            for (let i = 0; i < maxLen; i++) {
                if (userQueries[i]) markdown += `**User:**\n${userQueries[i].innerText}\n\n`;
                if (modelResponses[i]) markdown += `**Assistant:**\n${modelResponses[i].innerText}\n\n`;
            }
        }
        
        return markdown || "";
    } catch (error) {
        console.error("Chat Extraction Error: ", error);
        return "";
    }
}

async function uploadFile(uploadUrl, file, token, apiVersion) {

    let formData = new FormData();

    formData.append("file", file);

    // You can test the files by simply downloading them
    const testFileDownloading = false;
    if (testFileDownloading) {
        const downloadFileName = file?.name || "save-to-anytype-test-file.bin";

        try {
            if (!chrome.downloads || typeof chrome.downloads.download !== "function") {
                const currentPermissions = chrome?.runtime?.getManifest?.()?.permissions || [];
                console.error(
                    '[TEST DOWNLOAD] chrome.downloads API is not available. ' +
                    'Add permission "downloads" to save-to-anytype/manifest.json -> permissions[]. ' +
                    `Current permissions: ${JSON.stringify(currentPermissions)}`
                );
                throw new Error("chrome.downloads API is not available");
            }

            const toDataUrl = async (blob) => {
                if (typeof FileReader !== "undefined") {
                    return await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
                        reader.readAsDataURL(blob);
                    });
                }

                const arrayBuffer = await blob.arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);
                let binary = "";
                for (let i = 0; i < bytes.length; i += 1) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const base64 = btoa(binary);
                const mime = blob.type || "application/octet-stream";
                return `data:${mime};base64,${base64}`;
            };

            const downloadUrl = await toDataUrl(file);

            console.log(`[TEST DOWNLOAD] Starting test download for file: ${downloadFileName}, size: ${file.size} bytes, type: ${file.type}`);

            const listener = (item, suggest) => {
                suggest({
                    filename: downloadFileName
                });

                chrome.downloads.onDeterminingFilename.removeListener(listener);
            };

            chrome.downloads.onDeterminingFilename.addListener(listener);

            await chrome.downloads.download({
                url: downloadUrl,
                filename: downloadFileName,
                saveAs: false,
                conflictAction: "uniquify"
            });

            return {
                success: true,
                testDownload: true,
                fileName: downloadFileName
            };
        } catch (error) {
            throw new Error(`Test file download failed: ${error?.message || error}`);
        }
    }

    const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            'Accept': 'application/json',
            'Anytype-Version': apiVersion,
            redirect: 'follow'
        },
        body: formData
    });

    if (!response.ok) {
        const errorText =
            await response.text();

        throw new Error(
            `File upload failed: status: ${response.status}, errorText: ${errorText}, uploadUrl: ${uploadUrl}`
        );
    }

    return await response.json();
}

async function uploadImageFromUrl(uploadUrl, imageUrl, token, apiVersion, fileName) {
    consoleLog("Get image from URL: ", imageUrl);
    const response =
        await fetch(imageUrl);

    if (!response.ok) {
        throw new Error(
            "Failed to download image"
        );
    }

    const blob =
        await response.blob();

    const extension =
        blob.type.split("/")[1] || "png";

    const file = new File(
        [blob],
        fileName ? `${fileName}.${extension}` : `image.${extension}`,
        {
            type: blob.type
        }
    );

    return await uploadFile(
        uploadUrl,
        file,
        token,
        apiVersion
    );
}

// Read the Anytype API key and the target space id saved by the extension popup
async function getAnytypeConnection() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        throw new Error("chrome.storage.local API is not available");
    }

    const stored = await chrome.storage.local.get(["apiKey", "selectedSpaceId"]);

    const apiKey = stored ? stored.apiKey : "";
    const selectedSpaceId = stored ? stored.selectedSpaceId : "";

    if (!apiKey || !selectedSpaceId) {
        throw new Error("Anytype API key or space is not configured. Open the extension popup and set the API key and the target space.");
    }

    consoleLog("Anytype connection loaded from storage. Space id: ", selectedSpaceId);

    return { apiKey, selectedSpaceId };
}

// Download an image and wrap it into a File.
// Some sites only serve images to logged-in users, so "credentials: include" is tried
// first and "credentials: omit" is used as a fallback.
async function fetchImageAsFile(imageUrl, fileName) {
    consoleLog("Get image from URL: ", imageUrl);

    let blob = null;
    let lastError = null;

    for (const credentials of ["include", "omit"]) {
        try {
            const response = await fetch(imageUrl, { credentials: credentials });

            if (!response.ok) {
                lastError = new Error(`status: ${response.status}`);
                consoleError(`Image download returned status ${response.status} with credentials: ${credentials}`);
                continue;
            }

            blob = await response.blob();
            break;
        } catch (error) {
            lastError = error;
            consoleError(`Image download threw with credentials: ${credentials}`, error);
        }
    }

    if (!blob) {
        throw new Error(
            `Failed to download image: ${lastError?.message || lastError || "unknown error"}, imageUrl: ${imageUrl}`
        );
    }

    // blob.type can be empty, so guard it before splitting
    const mimeType = blob.type || "";
    const mimeExtension = mimeType.indexOf("/") !== -1 ? mimeType.split("/")[1] : "";

    const urlExtensionMatch = imageUrl.split(/[?#]/)[0].match(/\.([A-Za-z0-9]+)$/);
    const urlExtension = urlExtensionMatch ? urlExtensionMatch[1] : "";

    const extension = (mimeExtension.replace(/\+.*$/, "") || urlExtension || "png").toLowerCase();

    // Use the given file name, otherwise the last path segment of the image URL
    let baseName = fileName;

    if (!baseName) {
        try {
            const lastSegment = decodeURIComponent(new URL(imageUrl).pathname.split("/").filter(Boolean).pop() || "");
            baseName = lastSegment ? lastSegment.replace(/\.[^.]+$/, "") : "";
        } catch (error) {
            consoleError("Could not derive a file name from the image URL", error);
            baseName = "";
        }
    }

    if (!baseName) baseName = "image";

    return new File(
        [blob],
        `${baseName}.${extension}`,
        {
            type: mimeType || "application/octet-stream"
        }
    );
}

// Show a desktop notification; fall back to the console when the API is unavailable
function notifyUser(title, message, isError) {
    if (isError)
        consoleError(`${title} - ${message}`);
    else
        consoleLog(`${title} - ${message}`);

    if (typeof chrome === 'undefined' || typeof chrome.notifications === 'undefined') {
        consoleLog('chrome.notifications API is not available, logged to the console instead');
        return;
    }

    const notificationId = `save-image-to-anytype-${Date.now()}`;

    try {
        chrome.notifications.create(notificationId, {
            type: 'basic',
            iconUrl: 'assets/icon128.png',
            title: title,
            message: message
        });
    } catch (error) {
        consoleError('Failed to create the notification', error);
    }
}

// Context menu flow: download the clicked image, upload it as a file (which creates the
// image object in Anytype) and then create a "bookmark" wrapper that carries the picture
// and the source page URL
async function saveImageToAnytype(srcUrl, pageUrl) {
    try {
        consoleLog("saveImageToAnytype started. srcUrl: ", srcUrl, "pageUrl: ", pageUrl);

        const { apiKey, selectedSpaceId } = await getAnytypeConnection();

        const file = await fetchImageAsFile(srcUrl);
        consoleLog("Image downloaded: ", file.name, file.size, "bytes, type:", file.type);

        // The v2 files route is space-scoped. The file id comes back in the "id" field.
        const uploadedFile = await uploadFile(
            `${API_BASE_URL_V2}/spaces/${selectedSpaceId}/files`,
            file,
            apiKey,
            '2025-11-08'
        );

        const fileId = uploadedFile ? uploadedFile.id : "";
        if (!fileId) {
            throw new Error(`The file upload response did not contain an id: ${JSON.stringify(uploadedFile)}`);
        }

        consoleLog("File uploaded, id: ", fileId);

        const imageName = file.name.replace(/\.[^.]+$/, "") || "Image";

        // The upload above is already the image: in Anytype the "image" type is structurally a
        // file type (it maps to file_object), so every image object IS a FileObject. That forces
        // this two-step flow, and the wrapper cannot be simplified away:
        //   1. Creating an "image" through the object surface is impossible: the live API answers
        //      400 "creation of \"image\" objects is restricted" (the restriction is on the type
        //      definition and is enforced the same way for gRPC and templates, so no bypass exists).
        //   2. A FileObject is permanently un-editable through the object surface: PATCHing
        //      /objects/{id} fails with "this object is system-managed (FileObject) and cannot be
        //      edited through the object surface".
        // So the image itself can never carry the source page URL as a relation; the URL has to
        // live on a wrapper object. A "bookmark" is the natural wrapper: "picture" is a core file
        // property that points at the uploaded image object id, and "source" is a featured,
        // url-format property on the bookmark type that holds the page the image was found on.
        // Do not "simplify" this back into a single image object - it is guaranteed to fail.
        //
        // v2 does not require the Anytype-Version header. "picture" alone attaches the thumbnail,
        // so no "blocks" array is sent; an image block would instead force the mandatory
        // formatVersion:"2.0" field onto the block payload.
        const createResponse = await fetch(
            `${API_BASE_URL_V2}/spaces/${selectedSpaceId}/objects`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    type: "bookmark",
                    properties: {
                        name: imageName,
                        picture: [fileId],
                        source: pageUrl
                    }
                })
            }
        );

        if (!createResponse.ok) {
            const errorText = await createResponse.text();
            throw new Error(
                `Object creation failed: status: ${createResponse.status}, errorText: ${errorText}`
            );
        }

        const createdObject = await createResponse.json();
        const objectId = createdObject ? createdObject.id : "";

        if (!objectId) {
            throw new Error(`The object creation response did not contain an id: ${JSON.stringify(createdObject)}`);
        }

        consoleLog("Bookmark created, id: ", objectId);

        notifyUser("Save Image to Anytype", `Image saved with a bookmark holding the page URL. Bookmark id: ${objectId}`, false);
    } catch (error) {
        const errorText = String(error?.message || error);
        consoleError("saveImageToAnytype failed: ", error);
        notifyUser("Save Image to Anytype", `Failed to save the image. ${errorText}`, true);
    }
}

async function uploadHtmlPage(uploadUrl, pageUrl, token, apiVersion, fileName) {
    const response =
        await fetch(pageUrl);

    if (!response.ok) {
        throw new Error(
            "Failed to download html page"
        );
    }

    const html =
        await response.text();

    const file = new File(
        [html],
        (fileName || "page") + ".html",
        {
            type: "application/octet-stream"
        }
    );

    return await uploadFile(
        uploadUrl,
        file,
        token,
        apiVersion
    );
}
// END

async function uploadScreenshot(uploadUrl, token, apiVersion, fileName, screenshotUrl) {
    const response =
        await fetch(screenshotUrl);

    const blob =
        await response.blob();

    const file = new File(
        [blob],
        fileName + ".png" || "screenshot.png",
        {
            type: "image/png"
        }
    );

    return await uploadFile(
        uploadUrl,
        file,
        token,
        apiVersion
    );
}

//#endregion

// Utility function to get the appropriate browser API
function getAPI() {
    if (typeof chrome !== 'undefined' && chrome.contextMenus) {
        return chrome;
    }
    if (typeof browser !== 'undefined' && browser.contextMenus) {
        return browser;
    }
    consoleError('No browser API available!');
    return null;
}

// Create context menus on installation
function CreateContextMenusButtons(request) {
    consoleLog('CreateContextMenusButtons');

    const api = getAPI();
    if (!api) {
        consoleError('Browser API not available, cannot create context menus');
        return;
    }

    // Remove all existing context menus first
    api.contextMenus.removeAll(function () {
        consoleLog('Old context menus removed');
        consoleLog('request', request);

        // Create page context menu
        api.contextMenus.create({
            id: "save-to-Anytype",
            title: request.menuOption1,
            contexts: ["page", "link"]
        }, function () {
            if (chrome.runtime.lastError) {
                consoleError('Error creating save-to-Anytype menu:', chrome.runtime.lastError.message);
            } else {
                consoleLog('✓ Context menu "save-to-Anytype" created');
            }
        });

        // Create selection context menu
        chrome.contextMenus.create({
            id: "save-selection-to-Anytype",
            title: request.menuOption2,
            contexts: ["selection"]
        }, function () {
            if (chrome.runtime.lastError) {
                consoleError('Error creating save-selection menu:', chrome.runtime.lastError.message);
            } else {
                consoleLog('✓ Context menu "save-selection-to-Anytype" created');
            }
        });

        // Create image context menu
        api.contextMenus.create({
            id: "save-image-to-Anytype",
            title: request.menuOption3,
            contexts: ["image"]
        }, function () {
            if (chrome.runtime.lastError) {
                consoleError('Error creating save-image menu:', chrome.runtime.lastError.message);
            } else {
                consoleLog('✓ Context menu "save-image-to-Anytype" created');
            }
        });
    });
};

// Handle context menu clicks
if (chrome && chrome.contextMenus && chrome.contextMenus.onClicked) {
    chrome.contextMenus.onClicked.addListener(async function (info, tab) {
        consoleLog('Context menu clicked:', info.menuItemId);

        if (info.menuItemId === "save-to-Anytype") {
            // Normal page save - just open popup
            consoleLog('Opening popup for page save');
            try {
                await chrome.tabs.sendMessage(tab.id, { action: "OPEN_OVERLAY" });
            } catch (error) {
                consoleLog('Content script not found. Injecting content.js dynamically...', error);
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['content.js']
                    });
                    await new Promise(resolve => setTimeout(resolve, 150));
                    await chrome.tabs.sendMessage(tab.id, { action: "OPEN_OVERLAY" });
                } catch (injectError) {
                    consoleError('Could not open popup and failed to inject script:', injectError);
                }
            }
        }
        else if (info.menuItemId === "save-selection-to-Anytype") {
            // Save selected text
            consoleLog('Saving selected text');
            try {
                // Get selected text from content scriptlet response = null;
                let response = null;
                try {
                    response = await chrome.tabs.sendMessage(tab.id, { action: "getSelection" });
                } catch (err) {
                    consoleLog("Content script not found. Injecting content.js dynamically for getSelection...");
                    try {
                        await chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            files: ['content.js']
                        });
                        await new Promise(resolve => setTimeout(resolve, 150));
                        response = await chrome.tabs.sendMessage(tab.id, { action: "getSelection" });
                    } catch (injectError) {
                        consoleError("sendMessage failed even after injection:", injectError);
                    }
                }

                if (response && response.selectedText) {
                    // Save selected text to storage
                    await chrome.storage.local.set({
                        selectedText: response.selectedText,
                        selectedTextTimestamp: Date.now()
                    });
                    consoleLog('Selected text saved to storage');
                }

                // Open popup
                await chrome.tabs.sendMessage(tab.id, { action: "OPEN_OVERLAY" });
            } catch (error) {
                consoleError('Error handling selection:', error);
                // Still try to open popup
                try {
                    await chrome.tabs.sendMessage(tab.id, { action: "OPEN_OVERLAY" });
                } catch (popupError) {
                    consoleError('Could not open popup:', popupError);
                }
            }
        }
        else if (info.menuItemId === "save-image-to-Anytype") {
            // Save the clicked image as a standalone "image" object in Anytype
            consoleLog('Saving image to Anytype');

            const srcUrl = info.srcUrl;
            const pageUrl = info.pageUrl;

            if (!srcUrl) {
                consoleError('The context menu did not provide an image source URL', info);
                notifyUser("Save Image to Anytype", "Could not get the image source URL from the page.", true);
                return;
            }

            consoleLog('Image source URL:', srcUrl);
            consoleLog('Image page URL:', pageUrl);

            // saveImageToAnytype handles its own errors and shows the user notification
            await saveImageToAnytype(srcUrl, pageUrl);
        }
    });
} else {
    consoleError('contextMenus API not available');
}

// Message handling for communication between popup and content scripts
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.type === "log") {
        if (request.args !== undefined && request.args.length > 0)
            console.log("[SaveToAnytype] %c[Popap]%c " + request.message + " %c[Params]%c", "color: yellow; font-weight: bold;", "", "color: blue; font-weight: bold;", "", request.args);
        else
            console.log("[SaveToAnytype] %c[Popap]%c " + request.message, "color: yellow; font-weight: bold;", "");
    }
    else if (request.type === "error") {
        if (request.args !== undefined && request.args.length > 0)
            console.error("[SaveToAnytype] %c[Popap]%c " + request.message + " %c[Params]%c", "color: yellow; font-weight: bold;", "", "color: blue; font-weight: bold;", "", request.args);
        else
            console.error("[SaveToAnytype] %c[Popap]%c " + request.message, "color: yellow; font-weight: bold;", "");
    }

    if (request.action === "getTabInfo") {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                consoleLog('Sending tab info:', tabs[0].title);
                sendResponse({
                    title: tabs[0].title,
                    url: tabs[0].url
                });
            }
        });
        return true; // Keep the message channel open for async response
    }

    if (request.action === "CreateContextMenusButtons") {
        consoleLog('Saving to Anytype menu options ', request);
        CreateContextMenusButtons(request);
        return true;
    }

    if (request.action === "GET_TABS") {
        chrome.tabs.query(
            { active: true, currentWindow: true },
            (tabs) => {
                sendResponse(tabs);
            }
        );
        return true;
    }

    if (request.action === "GET_screenshotUrl") {
        sendResponse(screenshotUrl);
        return true;
    }

    if (request.action === "executeScript_findLargestVisibleImage") {
        chrome.scripting.executeScript(
            {
                target: request.target,
                func: findLargestVisibleImage
            },
            (result) => {
                consoleLog(result);
                sendResponse(result);
            }
        );
        return true;
    }

    if (request.action === "executeScript_findDescription") {
        chrome.scripting.executeScript(
            {
                target: request.target,
                func: findDescription
            },
            (result) => {
                consoleLog(result);
                sendResponse(result);
            }
        );
        return true;
    }

    if (request.action === "executeScript_extractPageText") {
        chrome.scripting.executeScript(
            {
                target: request.target,
                files: ["Libraries/Defuddle.js"]
            },
            () => {
                if (chrome.runtime.lastError) {
                    consoleError('Failed to inject Defuddle.js:', chrome.runtime.lastError.message);
                    sendResponse([{ result: "PAGE PARSE ERROR" }]);
                    return;
                }
                chrome.scripting.executeScript(
                    {
                        target: request.target,
                        func: extractPageText
                    },
                    (result) => {
                        consoleLog(result);
                        sendResponse(result);
                    }
                );
            }
        );
        return true;
    }

    if (request.action === "executeScript_extractChatText") {
        chrome.scripting.executeScript(
            {
                target: request.target,
                func: extractChatText
            },
            (result) => {
                sendResponse(result);
            }
        );
        return true;
    }

    if (request.action === "executeScript_GetElementByClassName") {
        const tabId = request?.target?.tabId;

        if (!tabId) {
            sendResponse({ success: false, error: "No tabId provided" });
            return true;
        }

        chrome.tabs.sendMessage(
            tabId,
            {
                action: "GET_ELEMENT_BY_CLASS_NAME",
                classNameAndDom: request.classNameAndDom
            },
            (result) => {
                if (chrome.runtime.lastError) {
                    sendResponse({
                        success: false,
                        error: chrome.runtime.lastError.message
                    });
                    return;
                }

                sendResponse(result || { success: false, error: "Empty response" });
            }
        );

        return true;
    }

    if (request.action === "executeScript_UploadImageFromUrl") {
        (async () => {
            try {
                const result =
                    await uploadImageFromUrl(
                        request.uploadUrl,
                        request.imageUrl,
                        request.token,
                        request.apiVersion,
                        request.fileName
                    );

                sendResponse({
                    success: true,
                    data: result
                });
            } catch (error) {
                consoleError("executeScript_UploadImageFromUrl failed", error?.message || error);
                sendResponse({
                    success: false,
                    error: String(error?.message || error)
                });
            }
        })();
        return true;
    }

    if (request.action === "executeScript_UploadHtmlFile") {
        (async () => {
            try {
                const result =
                    await uploadHtmlPage(
                        request.uploadUrl,
                        request.pageUrl,
                        request.token,
                        request.apiVersion,
                        request.fileName
                    );

                sendResponse({
                    success: true,
                    data: result
                });
            } catch (error) {
                consoleError("executeScript_UploadHtmlFile failed", error?.message || error);
                sendResponse({
                    success: false,
                    error: String(error?.message || error)
                });
            }
        })();
        return true;
    }

    if (request.action === "executeScript_UploadScreenshot") {
        (async () => {
            try {
                const result =
                    await uploadScreenshot(
                        request.uploadUrl,
                        request.token,
                        request.apiVersion,
                        request.fileName,
                        screenshotUrl
                    );

                sendResponse({
                    success: true,
                    data: result
                });
            } catch (error) {
                consoleError("executeScript_UploadScreenshot failed", error?.message || error);
                sendResponse({
                    success: false,
                    error: String(error?.message || error)
                });
            }
        })();
        return true;
    }

    if (request.action === "SET_ELEMENT_SELECTOR_LOCALIZATION") {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: "SET_ELEMENT_SELECTOR_LOCALIZATION",
                    localization: request.localization
                }, function (response) {
                    if (chrome.runtime.lastError) {
                        consoleError("Error sending localization to content:", chrome.runtime.lastError);
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        sendResponse({ success: true });
                    }
                });
            } else {
                sendResponse({ success: false, error: "No active tab found" });
            }
        });
        return true;
    }

    if (request.action === "START_PAGE_ELEMENT_SELECTION") {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: "START_PAGE_ELEMENT_SELECTION"
                }, function (response) {
                    if (chrome.runtime.lastError) {
                        consoleError("Error starting element selection:", chrome.runtime.lastError);
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        sendResponse({ success: true });
                    }
                });
            } else {
                sendResponse({ success: false, error: "No active tab found" });
            }
        });
        return true;
    }
});

let screenshotUrl = null;

chrome.action.onClicked.addListener(async (tab) => {
    const url = tab.url;

    const Qr = [
        "chrome://",
        "chrome.google.com/webstore'",
        "https://www.homedepot.com",
        "edge://",
        "arc://",
        "view-source:",
        "devtools:",
        "chrome-extension://",
        "about:",
        "about:",
        "https://chromewebstore.google.com/"
    ];

    if (url == undefined || Qr.some((t) => url.startsWith(t)) || url == "") {
        await chrome.action.setPopup({
            popup: "popupBlocked.html",
            tabId: tab.id,
        });
        await chrome.action.openPopup();
    } else {

        screenshotUrl =
            await chrome.tabs.captureVisibleTab(
                null,
                {
                    format: "png"
                }
            );

        chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_OVERLAY" }).catch(async (error) => {
            consoleLog('Content script not found. Injecting content.js dynamically...', error);
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
                // Small delay to allow the content script to initialize
                await new Promise(resolve => setTimeout(resolve, 150));
                await chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_OVERLAY" });
            } catch (injectError) {
                consoleError('Failed to inject content script dynamically:', injectError);
            }
        });
    }
});

// Keep service worker alive
chrome.alarms.create('keep-alive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === 'keep-alive') {
        consoleLog('Service worker keep-alive ping');
    }
});

consoleLog('Background script loaded successfully');