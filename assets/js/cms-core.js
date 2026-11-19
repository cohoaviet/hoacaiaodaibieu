/**
 * FILE: assets/js/cms-core.js
 * BẢN HỢP NHẤT HOÀN CHỈNH (FULL ALL-IN-ONE V4.0):
 * 1. Lưu ảnh vật lý trực tiếp vào thư mục "assets/uploads/" (UploadFolderManager - File System Access API + IndexedDB Cache)
 * 2. Động cơ lưu trữ IndexedDB 500MB (Khóa đồng bộ async/await chống mất bài khi chuyển trang)
 * 3. Chuẩn hóa kích thước ảnh 4:3 (800x600 & 1000x750) + Watermark "cohoaviet.vn 0975 121 636"
 * 4. Tự động đặt tên file ảnh chuẩn SEO (assets/uploads/ten-anh-seo.webp) & Tự động sinh/gắn Tag SEO
 * 5. Định tuyến URL sạch chuẩn SEO (SEORouter):
 *    - Bài đăng: hoacaiaodaibieu.vn/sanpham/hoa-cai-ao-dai-bieu-008/
 *    - Trang tĩnh: hoacaiaodaibieu.vn/hoa-cai-ao-dai-bieu/
 * 6. Bảo mật Tài khoản SHA-256 + Ẩn lượt xem với khách thường + Chống tấn công DoS + Thu thập SĐT Google Ads
 */

const MAX_STORAGE_QUOTA_KB = 512000; // 500 MB

function escapeHTML(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const ROLES = {
    ADMIN: 'admin',
    EDITOR: 'editor'
};

function getValidRole() {
    const r = localStorage.getItem('current_role');
    return (r === ROLES.ADMIN || r === ROLES.EDITOR) ? r : ROLES.ADMIN;
}

let currentUser = {
    username: 'admin',
    role: getValidRole()
};

const CATEGORY_NAMES = {
    'all': 'Tất Cả Sản Phẩm Nổi Bật',
    'hoa-cai-ao': 'Hoa Cài Áo Đại Biểu & Sự Kiện',
    'hoa-cai-ao-su-kien': 'Hoa Cài Áo Sự Kiện',
    'hoa-hong-do': 'Hoa Cài Áo - Hoa Hồng Đỏ',
    'no-8-canh': 'Hoa Cài Áo - Nơ 8 Cánh',
    'no-xep-ly': 'Hoa Cài Áo - Nơ Xếp Ly',
    'huy-hieu-tron': 'Huy Hiệu Tròn In Logo',
    'bang-ten': 'Bảng Tên & Thẻ Tên'
};

// ============================================================================
// 0. ĐỘNG CƠ LƯU TRỮ INDEXED-DB 500MB + KHO LƯU TRỮ FILE "assets/uploads/"
// ============================================================================
const HighCapacityDB = {
    dbName: 'CoHoaViet_CMS_500MB_DB',
    storeName: 'cms_data_store',
    dbInstance: null,
    isInitialized: false,
    initPromise: null,
    memoryCache: {
        cms_posts: null,
        cms_pages: null,
        cms_tags: null,
        cms_uploads_cache: null // Lưu bản sao vật lý của các ảnh trong assets/uploads/
    },

    ready() {
        if (this.isInitialized) return Promise.resolve(true);
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve) => {
            ['cms_posts', 'cms_pages', 'cms_tags'].forEach(key => {
                try {
                    const raw = localStorage.getItem(key);
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            this.memoryCache[key] = parsed;
                        }
                    }
                } catch (e) {}
            });

            if (!window.indexedDB) {
                this.isInitialized = true;
                resolve(false);
                return;
            }

            const request = indexedDB.open(this.dbName, 4);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };

            request.onsuccess = (e) => {
                this.dbInstance = e.target.result;
                const tx = this.dbInstance.transaction(this.storeName, 'readonly');
                const store = tx.objectStore(this.storeName);

                let keysLoaded = 0;
                const keys = ['cms_posts', 'cms_pages', 'cms_tags', 'cms_uploads_cache'];

                keys.forEach(key => {
                    const getReq = store.get(key);
                    getReq.onsuccess = () => {
                        if (getReq.result !== undefined && getReq.result !== null) {
                            this.memoryCache[key] = getReq.result;
                        } else if (Array.isArray(this.memoryCache[key]) && this.memoryCache[key].length > 0) {
                            this.setItem(key, this.memoryCache[key]);
                        }
                        keysLoaded++;
                        if (keysLoaded === keys.length) {
                            if (!this.memoryCache.cms_uploads_cache || typeof this.memoryCache.cms_uploads_cache !== 'object') {
                                this.memoryCache.cms_uploads_cache = {};
                            }
                            this.isInitialized = true;
                            window.dispatchEvent(new CustomEvent('cms_db_ready'));
                            resolve(true);
                        }
                    };
                    getReq.onerror = () => {
                        keysLoaded++;
                        if (keysLoaded === keys.length) {
                            this.isInitialized = true;
                            resolve(true);
                        }
                    };
                });
            };

            request.onerror = () => {
                this.isInitialized = true;
                resolve(false);
            };
        });

        return this.initPromise;
    },

    getItem(key) {
        if (this.memoryCache[key] !== null && this.memoryCache[key] !== undefined) {
            return this.memoryCache[key];
        }
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : (key === 'cms_uploads_cache' ? {} : []);
        } catch (e) {
            return key === 'cms_uploads_cache' ? {} : [];
        }
    },

    setItem(key, dataVal) {
        this.memoryCache[key] = dataVal;

        return new Promise((resolve) => {
            if (key !== 'cms_uploads_cache') {
                try {
                    const str = JSON.stringify(dataVal);
                    if (str.length < 4000000) {
                        localStorage.setItem(key, str);
                    } else if (key === 'cms_posts' || key === 'cms_pages') {
                        localStorage.removeItem(key);
                    }
                } catch (e) {
                    if (key === 'cms_posts' || key === 'cms_pages') localStorage.removeItem(key);
                }
            }

            if (this.dbInstance) {
                try {
                    const tx = this.dbInstance.transaction(this.storeName, 'readwrite');
                    const store = tx.objectStore(this.storeName);
                    store.put(dataVal, key);
                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => resolve(false);
                } catch (err) {
                    resolve(false);
                }
            } else {
                resolve(true);
            }
        });
    }
};

HighCapacityDB.ready();

// ============================================================================
// 0.1 BỘ QUẢN LÝ LƯU ẢNH TRỰC TIẾP VÀO THƯ MỤC "assets/uploads/"
// ============================================================================
const UploadFolderManager = {
    folderPath: 'assets/uploads/',
    dirHandle: null, // Con trỏ thư mục vật lý assets/uploads trên máy tính (File System Access API)
    autoDownloadOnUpload: localStorage.getItem('cms_auto_download_uploads') === 'true',

    // 1. Kết nối trực tiếp với thư mục assets/uploads trên ổ cứng máy tính (Dùng trong Antigravity IDE / Chrome / Edge)
    async connectPhysicalFolder() {
        if (!window.showDirectoryPicker) {
            alert('Trình duyệt hiện tại không hỗ trợ ghi trực tiếp vào thư mục. Hệ thống sẽ dùng chế độ Tải file .webp về thư mục assets/uploads/');
            return false;
        }
        try {
            this.dirHandle = await window.showDirectoryPicker({
                id: 'cohoaviet_uploads_dir',
                mode: 'readwrite'
            });
            return {
                connected: true,
                folderName: this.dirHandle.name
            };
        } catch (err) {
            return { connected: false, error: err.message };
        }
    },

    isFolderConnected() {
        return Boolean(this.dirHandle);
    },

    // Chuyển đổi chuỗi Base64 DataURL sang Blob nhị phân để ghi thành file .webp vật lý
    dataURLToBlob(dataURL) {
        const parts = dataURL.split(';base64,');
        const contentType = parts[0].split(':')[1];
        const raw = window.atob(parts[1]);
        const uInt8Array = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; ++i) {
            uInt8Array[i] = raw.charCodeAt(i);
        }
        return new Blob([uInt8Array], { type: contentType });
    },

    // 2. Lưu bức ảnh đã nén WebP vào thư mục "assets/uploads/<seoFilename>"
    async saveToUploadsFolder(seoFilename, webpDataUrl) {
        await HighCapacityDB.ready();
        const cleanFileName = seoFilename.replace(/^.*[\\\/]/, '');
        const relativePath = `${this.folderPath}${cleanFileName}`; // Ví dụ: assets/uploads/hoa-cai-ao-dai-bieu-cohoaviet-1.webp

        // A. Lưu vào bộ nhớ đệm IndexedDB 500MB theo key đường dẫn "assets/uploads/..."
        let uploadsCache = HighCapacityDB.getItem('cms_uploads_cache') || {};
        uploadsCache[relativePath] = {
            filename: cleanFileName,
            path: relativePath,
            dataUrl: webpDataUrl,
            sizeKB: Math.round((webpDataUrl.length * 3 / 4) / 1024),
            savedAt: new Date().toLocaleString('vi-VN')
        };
        await HighCapacityDB.setItem('cms_uploads_cache', uploadsCache);

        let physicalSaved = false;

        // B. Nếu đã kết nối thư mục vật lý assets/uploads -> Ghi thẳng file .webp vào ổ cứng!
        if (this.dirHandle) {
            try {
                const fileHandle = await this.dirHandle.getFileHandle(cleanFileName, { create: true });
                const writable = await fileHandle.createWritable();
                const blob = this.dataURLToBlob(webpDataUrl);
                await writable.write(blob);
                await writable.close();
                physicalSaved = true;
            } catch (e) {
                console.warn('Không thể ghi trực tiếp vào thư mục:', e);
            }
        } else if (this.autoDownloadOnUpload) {
            // C. Nếu bật chế độ tự tải file .webp về máy khi upload
            this.triggerFileDownload(cleanFileName, webpDataUrl);
        }

        return {
            relativePath: relativePath, // Đường dẫn chuẩn: assets/uploads/ten-file.webp
            displayUrl: physicalSaved ? relativePath : webpDataUrl,
            physicalSaved: physicalSaved
        };
    },

    // Tải 1 file ảnh .webp về máy tính để đặt vào assets/uploads/
    triggerFileDownload(filename, dataUrl) {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
    },

    // Đồng bộ toàn bộ ảnh đang có trong kho 500MB ra thư mục vật lý assets/uploads chỉ với 1 cú click
    async syncAllCachedImagesToPhysicalFolder() {
        await HighCapacityDB.ready();
        if (!this.dirHandle) {
            const res = await this.connectPhysicalFolder();
            if (!res || !res.connected) return { success: false, count: 0 };
        }

        const uploadsCache = HighCapacityDB.getItem('cms_uploads_cache') || {};
        const entries = Object.values(uploadsCache);
        let count = 0;

        for (const item of entries) {
            if (item && item.dataUrl && item.filename) {
                try {
                    const fileHandle = await this.dirHandle.getFileHandle(item.filename, { create: true });
                    const writable = await fileHandle.createWritable();
                    const blob = this.dataURLToBlob(item.dataUrl);
                    await writable.write(blob);
                    await writable.close();
                    count++;
                } catch (e) {}
            }
        }
        return { success: true, count: count, folderName: this.dirHandle.name };
    },

    // Tự động khôi phục ảnh từ kho đệm IndexedDB nếu thẻ <img src="assets/uploads/..."> chưa được copy ra ổ cứng
    bindAutoFallbackForUploadImages() {
        window.addEventListener('error', (e) => {
            const el = e.target;
            if (el && el.tagName === 'IMG') {
                const rawSrc = el.getAttribute('src') || '';
                const seoFile = el.getAttribute('data-seo-filename') || '';
                const uploadsCache = HighCapacityDB.getItem('cms_uploads_cache') || {};

                if (rawSrc.includes('assets/uploads/') && uploadsCache[rawSrc]) {
                    el.src = uploadsCache[rawSrc].dataUrl;
                } else if (seoFile && uploadsCache[`assets/uploads/${seoFile}`]) {
                    el.src = uploadsCache[`assets/uploads/${seoFile}`].dataUrl;
                }
            }
        }, true);
    }
};

UploadFolderManager.bindAutoFallbackForUploadImages();

function getStorageUsageKB() {
    let totalBytes = 0;
    try {
        const postsStr = JSON.stringify(HighCapacityDB.getItem('cms_posts') || []);
        const pagesStr = JSON.stringify(HighCapacityDB.getItem('cms_pages') || []);
        const tagsStr = JSON.stringify(HighCapacityDB.getItem('cms_tags') || []);
        const uploadsStr = JSON.stringify(HighCapacityDB.getItem('cms_uploads_cache') || {});
        totalBytes += (postsStr.length + pagesStr.length + tagsStr.length + uploadsStr.length) * 2;
    } catch (e) {}

    for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key) && !['cms_posts', 'cms_pages', 'cms_tags'].includes(key)) {
            totalBytes += (localStorage[key].length + key.length) * 2;
        }
    }
    return Math.round(totalBytes / 1024);
}

// ============================================================================
// 1. ĐỒNG BỘ KÍCH THƯỚC ẢNH 4:3 + WATERMARK + LƯU VÀO "assets/uploads/"
// ============================================================================
function optimizeAndUploadImage(file, targetWidth = 800, quality = 0.82, watermarkMode = 'both', watermarkOpacity = 0.4, seoContext = {}) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                const finalWidth = targetWidth;
                const finalHeight = Math.round(finalWidth * 0.75); // Tỷ lệ chuẩn 4:3
                const safeQuality = quality;

                canvas.width = finalWidth;
                canvas.height = finalHeight;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                const imgRatio = img.width / img.height;
                const targetRatio = finalWidth / finalHeight;
                let srcX = 0, srcY = 0, srcW = img.width, srcH = img.height;

                if (imgRatio > targetRatio) {
                    srcW = Math.round(img.height * targetRatio);
                    srcX = Math.round((img.width - srcW) / 2);
                } else {
                    srcH = Math.round(img.width / targetRatio);
                    srcY = Math.round((img.height - srcH) / 2);
                }

                ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, finalWidth, finalHeight);

                const watermarkText = "cohoaviet.vn 0975 121 636";
                const alpha = Math.min(0.95, Math.max(0.05, parseFloat(watermarkOpacity) || 0.4));

                if (watermarkMode === 'both' || watermarkMode === 'center') {
                    ctx.save();
                    const centerFontSize = Math.max(16, Math.round(finalWidth * 0.045));
                    ctx.font = `bold ${centerFontSize}px system-ui, -apple-system, sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.translate(finalWidth / 2, finalHeight / 2);
                    ctx.rotate(-25 * Math.PI / 180);

                    ctx.shadowColor = `rgba(0, 0, 0, ${Math.min(0.85, alpha + 0.2)})`;
                    ctx.shadowBlur = 5;
                    ctx.shadowOffsetX = 2;
                    ctx.shadowOffsetY = 2;

                    ctx.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.6})`;
                    ctx.lineWidth = 2;
                    ctx.strokeText(watermarkText, 0, 0);

                    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                    ctx.fillText(watermarkText, 0, 0);
                    ctx.restore();
                }

                if (watermarkMode === 'tiled') {
                    ctx.save();
                    const tileFontSize = Math.max(13, Math.round(finalWidth * 0.028));
                    ctx.font = `bold ${tileFontSize}px system-ui, -apple-system, sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.shadowColor = `rgba(0, 0, 0, ${Math.min(0.8, alpha + 0.15)})`;
                    ctx.shadowBlur = 4;
                    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;

                    const stepX = Math.round(finalWidth * 0.42);
                    const stepY = Math.round(finalHeight * 0.28);

                    for (let y = stepY / 2; y < finalHeight; y += stepY) {
                        for (let x = stepX / 2; x < finalWidth; x += stepX) {
                            ctx.save();
                            ctx.translate(x, y);
                            ctx.rotate(-25 * Math.PI / 180);
                            ctx.fillText(watermarkText, 0, 0);
                            ctx.restore();
                        }
                    }
                    ctx.restore();
                }

                if (watermarkMode === 'both' || watermarkMode === 'corner-br' || watermarkMode === 'corner-bl') {
                    ctx.save();
                    const cornerFontSize = Math.max(12, Math.round(finalWidth * 0.025));
                    ctx.font = `700 ${cornerFontSize}px system-ui, -apple-system, sans-serif`;
                    ctx.textBaseline = 'bottom';

                    const paddingX = Math.round(finalWidth * 0.025);
                    const paddingY = Math.round(finalHeight * 0.025);

                    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
                    ctx.shadowBlur = 4;
                    ctx.shadowOffsetX = 1;
                    ctx.shadowOffsetY = 1;

                    const cornerAlpha = Math.min(0.95, alpha + 0.3);
                    ctx.fillStyle = `rgba(255, 255, 255, ${cornerAlpha})`;

                    if (watermarkMode === 'corner-bl') {
                        ctx.textAlign = 'left';
                        ctx.fillText(watermarkText, paddingX, finalHeight - paddingY);
                    } else {
                        ctx.textAlign = 'right';
                        ctx.fillText(watermarkText, finalWidth - paddingX, finalHeight - paddingY);
                    }
                    ctx.restore();
                }

                const rawFileBase = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
                const catKey = seoContext.category || 'hoa-cai-ao';
                const catLabel = CATEGORY_NAMES[catKey] || 'Hoa cài áo đại biểu';
                const baseTitle = (seoContext.postTitle || '').trim() || catLabel;
                const imgIndex = seoContext.index || 1;

                const seoSlugBase = TagManager.toSlug(baseTitle) || TagManager.toSlug(rawFileBase) || 'hoa-cai-ao-dai-bieu';
                const seoFilename = `${seoSlugBase}-cohoaviet-${imgIndex}.webp`;
                const autoAlt = (seoContext.customAlt || '').trim() || `${baseTitle} - ${catLabel} Cờ Hoa Việt (Mẫu ${imgIndex})`;
                const autoGeneratedTags = TagManager.autoExtractAndEnsureTags(baseTitle, catKey, rawFileBase);

                let webpDataUrl = canvas.toDataURL('image/webp', safeQuality);
                if (webpDataUrl.length > file.size * 1.3) {
                    webpDataUrl = canvas.toDataURL('image/jpeg', safeQuality);
                }

                // LƯU ẢNH VÀO THƯ MỤC "assets/uploads/" QUA UPLOAD FOLDER MANAGER
                const folderSaveResult = await UploadFolderManager.saveToUploadsFolder(seoFilename, webpDataUrl);

                resolve({
                    // Nếu đã kết nối thư mục vật lý assets/uploads, dùng luôn đường dẫn sạch "assets/uploads/ten-anh.webp"
                    dataUrl: folderSaveResult.physicalSaved ? folderSaveResult.relativePath : webpDataUrl,
                    rawBase64: webpDataUrl,
                    uploadPath: folderSaveResult.relativePath, // Luôn có dạng: assets/uploads/hoa-cai-ao-dai-bieu-cohoaviet-1.webp
                    physicalSaved: folderSaveResult.physicalSaved,
                    seoFilename: seoFilename,
                    autoAlt: autoAlt,
                    autoTags: autoGeneratedTags,
                    originalSize: (file.size / 1024).toFixed(1) + ' KB',
                    optimizedSize: Math.round((webpDataUrl.length * 3 / 4) / 1024) + ' KB',
                    dimensions: `${finalWidth}x${finalHeight}`
                });
            };
            img.onerror = (err) => reject(err);
        };
    });
}

// ============================================================================
// 2. QUẢN LÝ BÀI VIẾT SẢN PHẨM (LƯU ĐỒNG BỘ VÀO KHO 500MB INDEXED-DB)
// ============================================================================
const PostManager = {
    getAll: () => {
        const list = HighCapacityDB.getItem('cms_posts');
        return Array.isArray(list) ? list : [];
    },

    savePost: async (postData) => {
        await HighCapacityDB.ready();
        currentUser.role = getValidRole();
        let posts = PostManager.getAll();
        const cleanId = (postData.id || '').toString().trim();

        if (cleanId !== '') {
            const index = posts.findIndex(p => String(p.id) === cleanId);
            if (index !== -1) {
                posts[index] = {
                    ...posts[index],
                    ...postData,
                    id: cleanId,
                    updatedAt: new Date().toISOString()
                };
            } else {
                postData.id = 'post_' + Date.now();
                postData.createdAt = new Date().toISOString();
                postData.views = 1;
                posts.unshift(postData);
            }
        } else {
            postData.id = 'post_' + Date.now();
            postData.createdAt = new Date().toISOString();
            postData.views = 1;
            posts.unshift(postData);
        }

        await HighCapacityDB.setItem('cms_posts', posts);
        localStorage.setItem('cms_local_modified', 'true');
        return { success: true, mode: cleanId ? 'edit' : 'create', post: postData };
    },

    deletePost: async (postId) => {
        await HighCapacityDB.ready();
        currentUser.role = getValidRole();
        if (currentUser.role !== ROLES.ADMIN) {
            alert('CẢNH BÁO PHÂN QUYỀN: Tài khoản Editor chỉ có quyền Đăng và Sửa bài, không có quyền Xóa!');
            return false;
        }
        let posts = PostManager.getAll().filter(p => String(p.id) !== String(postId));
        await HighCapacityDB.setItem('cms_posts', posts);
        localStorage.setItem('cms_local_modified', 'true');
        return true;
    }
};

// ============================================================================
// 3. QUẢN LÝ SỬA & XÓA ẢNH TOÀN HỆ THỐNG (MEDIA MANAGER)
// ============================================================================
const MediaManager = {
    getAllImages: () => {
        const posts = PostManager.getAll();
        const mediaList = [];

        posts.forEach(post => {
            if (post.thumb) {
                const fName = post.thumbSeoName || `${post.slug}-cohoaviet-1.webp`;
                mediaList.push({
                    mediaId: `thumb_${post.id}`,
                    postId: post.id,
                    postTitle: post.title,
                    type: 'thumbnail',
                    typeLabel: '🖼️ Ảnh đại diện',
                    src: post.thumb,
                    alt: post.thumbAlt || post.title,
                    seoFilename: fName,
                    uploadPath: `assets/uploads/${fName.replace(/^.*[\\\/]/, '')}`,
                    inlineIndex: -1
                });
            }

            const parser = new DOMParser();
            const doc = parser.parseFromString(post.content || '', 'text/html');
            const imgs = doc.querySelectorAll('img');
            imgs.forEach((img, idx) => {
                const fName = img.getAttribute('data-seo-filename') || `${post.slug}-chi-tiet-${idx + 1}.webp`;
                mediaList.push({
                    mediaId: `inline_${post.id}_${idx}`,
                    postId: post.id,
                    postTitle: post.title,
                    type: 'inline',
                    typeLabel: `🔍 Ảnh trong bài #${idx + 1}`,
                    src: img.getAttribute('src') || '',
                    alt: img.getAttribute('alt') || post.title,
                    seoFilename: fName,
                    uploadPath: img.getAttribute('data-upload-path') || `assets/uploads/${fName.replace(/^.*[\\\/]/, '')}`,
                    inlineIndex: idx
                });
            });
        });

        return mediaList;
    },

    updateImage: async (postId, type, inlineIndex, { newSrc, newAlt, newSeoName }) => {
        await HighCapacityDB.ready();
        let posts = PostManager.getAll();
        const pIdx = posts.findIndex(p => String(p.id) === String(postId));
        if (pIdx === -1) return false;

        if (type === 'thumbnail') {
            if (newSrc) posts[pIdx].thumb = newSrc;
            if (newAlt) posts[pIdx].thumbAlt = newAlt;
            if (newSeoName) {
                posts[pIdx].thumbSeoName = newSeoName;
                posts[pIdx].thumbUploadPath = `assets/uploads/${newSeoName.replace(/^.*[\\\/]/, '')}`;
            }
        } else {
            const parser = new DOMParser();
            const doc = parser.parseFromString(posts[pIdx].content || '', 'text/html');
            const imgs = doc.querySelectorAll('img');
            if (imgs[inlineIndex]) {
                if (newSrc) imgs[inlineIndex].setAttribute('src', newSrc);
                if (newAlt) {
                    imgs[inlineIndex].setAttribute('alt', newAlt);
                    imgs[inlineIndex].setAttribute('title', newAlt);
                }
                if (newSeoName) {
                    const cleanName = newSeoName.replace(/^.*[\\\/]/, '');
                    imgs[inlineIndex].setAttribute('data-seo-filename', cleanName);
                    imgs[inlineIndex].setAttribute('data-upload-path', `assets/uploads/${cleanName}`);
                }
                posts[pIdx].content = doc.body.innerHTML;
            }
        }

        await HighCapacityDB.setItem('cms_posts', posts);
        localStorage.setItem('cms_local_modified', 'true');
        return true;
    },

    deleteImage: async (postId, type, inlineIndex) => {
        await HighCapacityDB.ready();
        currentUser.role = getValidRole();
        if (currentUser.role !== ROLES.ADMIN) {
            alert('Chỉ tài khoản Admin toàn quyền mới được phép xóa ảnh!');
            return false;
        }

        let posts = PostManager.getAll();
        const pIdx = posts.findIndex(p => String(p.id) === String(postId));
        if (pIdx === -1) return false;

        if (type === 'thumbnail') {
            posts[pIdx].thumb = 'https://via.placeholder.com/800x600/b71c1c/ffffff.webp?text=Co+Hoa+Viet+800x600';
        } else {
            const parser = new DOMParser();
            const doc = parser.parseFromString(posts[pIdx].content || '', 'text/html');
            const imgs = doc.querySelectorAll('img');
            if (imgs[inlineIndex]) {
                imgs[inlineIndex].remove();
                posts[pIdx].content = doc.body.innerHTML;
            }
        }

        await HighCapacityDB.setItem('cms_posts', posts);
        localStorage.setItem('cms_local_modified', 'true');
        return true;
    }
};

// ============================================================================
// 4. QUẢN LÝ TRANG TĨNH / LANDING PAGE QUẢNG CÁO ADS & TAG SEO
// ============================================================================
const PageManager = {
    getAll: () => {
        const list = HighCapacityDB.getItem('cms_pages');
        return Array.isArray(list) ? list : [];
    },

    savePage: async (page) => {
        await HighCapacityDB.ready();
        currentUser.role = getValidRole();
        if (currentUser.role !== ROLES.ADMIN) {
            alert('Chỉ Admin mới có quyền thêm/sửa Trang tĩnh & Landing Page Quảng cáo!');
            return false;
        }
        let pages = PageManager.getAll();
        const cleanId = (page.id || '').toString().trim();

        if (cleanId !== '') {
            const idx = pages.findIndex(p => String(p.id) === cleanId);
            if (idx !== -1) {
                pages[idx] = { ...pages[idx], ...page, id: cleanId, updatedAt: new Date().toISOString() };
            } else {
                page.id = 'page_' + Date.now();
                page.views = 1;
                pages.unshift(page);
            }
        } else {
            page.id = 'page_' + Date.now();
            page.views = 1;
            pages.unshift(page);
        }
        await HighCapacityDB.setItem('cms_pages', pages);
        localStorage.setItem('cms_local_modified', 'true');
        return true;
    },

    deletePage: async (id) => {
        await HighCapacityDB.ready();
        currentUser.role = getValidRole();
        if (currentUser.role !== ROLES.ADMIN) {
            alert('Chỉ Admin mới có quyền xóa Trang tĩnh!');
            return false;
        }
        let pages = PageManager.getAll().filter(p => String(p.id) !== String(id));
        await HighCapacityDB.setItem('cms_pages', pages);
        localStorage.setItem('cms_local_modified', 'true');
        return true;
    }
};

const TagManager = {
    getAll: () => HighCapacityDB.getItem('cms_tags') || [],

    toSlug: (str) => {
        return (str || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[đĐ]/g, 'd')
            .replace(/([^0-9a-z-\s])/g, '')
            .replace(/(\s+)/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '');
    },

    saveTag: (tagData) => {
        let tags = TagManager.getAll();
        tagData.slug = TagManager.toSlug(tagData.name);
        if (!tagData.slug) return false;

        if (tagData.id) {
            const idx = tags.findIndex(t => String(t.id) === String(tagData.id));
            if (idx !== -1) tags[idx] = tagData;
        } else {
            const existing = tags.find(t => t.slug === tagData.slug);
            if (existing) return existing;
            tagData.id = 'tag_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5);
            tags.push(tagData);
        }
        HighCapacityDB.setItem('cms_tags', tags);
        return tagData;
    },

    deleteTag: (tagId) => {
        currentUser.role = getValidRole();
        if (currentUser.role !== ROLES.ADMIN) {
            alert('Chỉ Admin mới có quyền xóa Tag SEO!');
            return false;
        }
        let tags = TagManager.getAll().filter(t => String(t.id) !== String(tagId));
        HighCapacityDB.setItem('cms_tags', tags);
        return true;
    },

    autoExtractAndEnsureTags: (postTitle = '', categoryKey = 'hoa-cai-ao', rawFileName = '') => {
        const candidateNames = new Set();
        if (CATEGORY_NAMES[categoryKey] && categoryKey !== 'all') {
            candidateNames.add(CATEGORY_NAMES[categoryKey]);
        }

        const combinedText = `${postTitle} ${rawFileName}`.toLowerCase();
        const keywordDictionary = [
            { match: ['hoa cài áo', 'hoa đại biểu', 'hoa cai ao'], tag: 'Hoa cài áo đại biểu' },
            { match: ['huy hiệu', 'huy hieu', 'pin cài', 'badge'], tag: 'Huy hiệu tròn in logo' },
            { match: ['hoa cài sự kiện', 'hoa cai su kien', 'ruy băng', 'ruy bang'], tag: 'Hoa cài áo sự kiện' },
            { match: ['bảng tên', 'bang ten', 'thẻ tên', 'the ten'], tag: 'Bảng tên - Thẻ tên' },
            { match: ['đại hội', 'dai hoi'], tag: 'Phụ kiện đại hội' },
            { match: ['đỏ đô', 'do do', 'đỏ tươi'], tag: 'Hoa đại biểu đỏ đô' }
        ];

        keywordDictionary.forEach(item => {
            if (item.match.some(k => combinedText.includes(k))) {
                candidateNames.add(item.tag);
            }
        });

        const cleanTitle = postTitle.trim();
        if (cleanTitle.length >= 6 && cleanTitle.length <= 45) {
            candidateNames.add(cleanTitle);
        }

        const resultingSlugs = [];
        candidateNames.forEach(name => {
            const slug = TagManager.toSlug(name);
            if (slug) {
                TagManager.saveTag({
                    name: name,
                    desc: `Tổng hợp mẫu ${name} chất lượng cao, sản xuất trực tiếp tại xưởng Cờ Hoa Việt.`
                });
                resultingSlugs.push(slug);
            }
        });

        return resultingSlugs;
    }
};

// ============================================================================
// 5. ĐẾM LƯỢT TRUY CẬP WEB (ANALYTICS)
// ============================================================================
const Analytics = {
    recordVisit: (pagePath = window.location.pathname) => {
        let stats = JSON.parse(localStorage.getItem('cms_analytics') || '{"total": 0, "pages": {}, "daily": {}, "impressions": 0}');
        const today = new Date().toISOString().split('T')[0];

        stats.impressions = (stats.impressions || stats.total || 0) + 1;

        if (!sessionStorage.getItem('visited_' + pagePath)) {
            stats.total += 1;
            stats.pages[pagePath] = (stats.pages[pagePath] || 0) + 1;
            stats.daily[today] = (stats.daily[today] || 0) + 1;
            sessionStorage.setItem('visited_' + pagePath, 'true');
        }
        localStorage.setItem('cms_analytics', JSON.stringify(stats));
        return stats;
    }
};

// ============================================================================
// 6. KHỞI TẠO DỮ LIỆU MẪU AN TOÀN (ĐỢI INDEXED-DB ĐỌC XONG MỚI KIỂM TRA)
// ============================================================================
async function ensureDefaultCMSData() {
    await HighCapacityDB.ready();

    if (TagManager.getAll().length === 0) {
        TagManager.saveTag({ name: 'Hoa cài áo đại biểu', desc: 'Mẫu hoa cài áo đại biểu sự kiện trang trọng' });
        TagManager.saveTag({ name: 'Huy hiệu tròn in logo', desc: 'Huy hiệu tròn cài áo in logo theo yêu cầu' });
        TagManager.saveTag({ name: 'Hoa cài áo sự kiện', desc: 'Hoa ruy băng cài áo khách VIP' });
        TagManager.saveTag({ name: 'Bảng tên & Thẻ tên', desc: 'Bảng tên - Thẻ tên nhân viên' });
    }

    if (PostManager.getAll().length === 0 && localStorage.getItem('cms_local_modified') !== 'true') {
        const samplePosts = [
            {
                id: 'post_sample_1',
                title: 'Hoa Cài Áo Đại Biểu Đỏ Đô Kết Hợp Huy Hiệu Tròn In Logo Đại Hội',
                subTitle: 'Hoa cài áo đại biểu 8 cánh & Huy hiệu sự kiện in logo',
                slug: 'hoa-cai-ao-dai-bieu-008',
                category: 'hoa-cai-ao',
                colors: 'Đỏ đô, đỏ tươi, xanh dương, vàng kim, xanh lá cây,....',
                material: 'Ruy băng lụa ép nhiệt cao cấp, mặt huy hiệu nhựa/kim loại phủ màng bóng',
                styleSpec: 'Màu sắc đa dạng, kiểu hoa tròn 8 cánh hoặc cánh nhọn, gắn ghim băng hoặc nam châm',
                metaDesc: 'Chuyên sản xuất hoa cài áo đại biểu ruy băng cao cấp kết hợp mặt huy hiệu tròn in sắc nét, ghim cài chắc chắn cho các kỳ Đại hội, lễ kỷ niệm.',
                thumb: 'https://via.placeholder.com/800x600/b71c1c/ffffff.webp?text=Hoa+Cai+Ao+Dai+Bieu+008',
                thumbSeoName: 'hoa-cai-ao-dai-bieu-008-cohoaviet-1.webp',
                thumbUploadPath: 'assets/uploads/hoa-cai-ao-dai-bieu-008-cohoaviet-1.webp',
                thumbAlt: 'Hoa Cài Áo Đại Biểu Đỏ Đô Kết Hợp Huy Hiệu Tròn In Logo Đại Hội - Cờ Hoa Việt',
                content: '<p>Sản phẩm <strong>Hoa cài áo đại biểu</strong> được xếp ly tỉ mỉ từ ruy băng lụa cao cấp, phần đuôi cắt nhiệt sắc sảo chống tưa sợi. Ở chính giữa gắn mặt <strong>huy hiệu tròn</strong> in nội dung sự kiện hoặc logo doanh nghiệp.</p><img src="https://via.placeholder.com/800x600/991b1b/ffffff.webp?text=Chi+Tiet+Hoa+Cai+Ao+008" alt="Chi tiết hoa cài áo đại biểu" title="Chi tiết hoa cài áo đại biểu" data-seo-filename="chi-tiet-hoa-cai-ao-dai-bieu-cohoaviet-1.webp" data-upload-path="assets/uploads/chi-tiet-hoa-cai-ao-dai-bieu-cohoaviet-1.webp" class="zoomable">',
                tags: ['hoa-cai-ao-dai-bieu', 'huy-hieu-tron-in-logo'],
                views: 342,
                createdAt: new Date().toISOString()
            },
            {
                id: 'post_sample_2',
                title: 'Bảng Tên Nhân Viên',
                subTitle: 'bảng tên đại biểu',
                slug: 'bang-ten-dai-bieu',
                category: 'bang-ten',
                colors: 'Xanh, đỏ, vàng, xanh lá cây, xanh dương, đen, nâu,....',
                material: 'Da, Hợp kim nhôm, Nhựa Mica trong suốt',
                styleSpec: 'Màu sắc đa dạng',
                metaDesc: 'Cung cấp bảng tên, thẻ tên nhân viên',
                thumb: 'https://via.placeholder.com/800x600/0088cc/ffffff.webp?text=Bao+Dung+The+Nhom+Va+Da',
                thumbSeoName: 'bang-ten-the-ten-nhan-viencohoaviet-1.webp',
                thumbUploadPath: 'assets/uploads/bang-ten-the-ten-nhan-viencohoaviet-1.webp',
                thumbAlt: 'Bảng tên- Thẻ Tên - Cờ Hoa Việt',
                content: '<p><strong>Bảng tên chất liệu đồng, hợp kim nhôm</strong> độ bền cao, bảo vệ thẻ nhân viên và thẻ đại biểu sự kiện không bị cong gãy hay phai màu.</p>',
                tags: ['the-bang-ten', 'huy-hieu-tron-in-logo'],
                views: 268,
                createdAt: new Date().toISOString()
            },
            {
                id: 'post_sample_3',
                title: 'Huy Hiệu Tròn Cài Áo In Logo Sự Kiện (Đủ Kích Thước 4.4cm - 5.8cm)',
                subTitle: 'Huy hiệu tròn cài áo nhựa & kim loại in logo theo yêu cầu',
                slug: 'huy-hieu-tron-cai-ao-in-logo-su-kien',
                category: 'huy-hieu-tron',
                colors: 'In full màu sắc nét theo nhận diện thương hiệu (Đỏ, xanh, vàng, trắng, đen,...)',
                material: 'Nhựa nguyên sinh ABS cứng cáp hoặc Phôi kim loại/đồng phủ màng MyLar bóng',
                styleSpec: 'Hình tròn đường kính 3.2cm, 4.4cm, 5.8cm; mặt sau gắn kim băng cài hoặc nam châm',
                metaDesc: 'Xưởng in huy hiệu tròn cài áo nhựa, huy hiệu kim loại phủ màng bóng sắc nét, giá gốc tận xưởng cho công ty, trường học.',
                thumb: 'https://via.placeholder.com/800x600/1e293b/ffffff.webp?text=Huy+Hieu+Tron+In+Logo',
                thumbSeoName: 'huy-hieu-tron-cai-ao-in-logo-cohoaviet-1.webp',
                thumbUploadPath: 'assets/uploads/huy-hieu-tron-cai-ao-in-logo-cohoaviet-1.webp',
                thumbAlt: 'Huy Hiệu Tròn Cài Áo In Logo Sự Kiện - Cờ Hoa Việt',
                content: '<p><strong>Huy hiệu tròn cài áo</strong> là giải pháp nhận diện thương hiệu tiết kiệm và hiệu quả cao cho các chiến dịch truyền thông, lễ kỷ niệm, ra mắt sản phẩm.</p>',
                tags: ['huy-hieu-tron-in-logo'],
                views: 215,
                createdAt: new Date().toISOString()
            },
            {
                id: 'post_sample_4',
                title: 'Hoa Cài Áo Sự Kiện Phối Ruy Băng 2 Tầng Sang Trọng Cho Khách VIP',
                subTitle: 'Hoa cài áo đại biểu & khách VIP phối ruy băng cao cấp',
                slug: 'no-cai-ao-su-kien-ruy-bang-2-tang',
                category: 'hoa-cai-ao-su-kien',
                colors: 'Đỏ đô, đỏ tươi, xanh coban, vàng đồng, tím, xanh lá,...',
                material: 'Ruy băng lụa satin 2 lớp cắt nhiệt chống tưa sợi, ghim cài hợp kim',
                styleSpec: 'Kiểu hoa xếp tầng kết hợp đuôi ruy băng vát nhọn hoặc in chữ nhũ vàng',
                metaDesc: 'Thiết kế hoa cài áo sự kiện phối ruy băng 2 tầng tinh tế, đồng bộ màu sắc thương hiệu doanh nghiệp.',
                thumb: 'https://via.placeholder.com/800x600/0284c7/ffffff.webp?text=No+Cai+Ao+Su+Kien+2+Tang',
                thumbSeoName: 'no-cai-ao-su-kien-ruy-bang-2-tang-cohoaviet-1.webp',
                thumbUploadPath: 'assets/uploads/no-cai-ao-su-kien-ruy-bang-2-tang-cohoaviet-1.webp',
                thumbAlt: 'Hoa Cài Áo Sự Kiện Phối Ruy Băng 2 Tầng - Cờ Hoa Việt',
                content: '<p>Mẫu <strong>hoa cài áo sự kiện</strong> phối 2 lớp ruy băng trung tâm nổi bật, liên kết keo chuyên dụng bền chắc và ghim băng an toàn không làm xước vải vest đại biểu.</p>',
                tags: ['no-cai-ao-su-kien', 'hoa-cai-ao-dai-bieu'],
                views: 189,
                createdAt: new Date().toISOString()
            }
        ];
        await HighCapacityDB.setItem('cms_posts', samplePosts);
    }

    if (PageManager.getAll().length === 0) {
        const samplePages = [
            {
                id: 'page_ads_1',
                title: 'Hoa Cài Áo Đại Biểu & Huy Hiệu Tròn In Logo - Bảng Giá Xưởng',
                slug: 'hoa-cai-ao-dai-bieu',
                promoBadge: '⭐ XƯỞNG SẢN XUẤT TRỰC TIẾP - CHIẾT KHẤU CAO CHO ĐẠI HỘI & SỰ KIỆN',
                metaDesc: 'Báo giá gốc tận xưởng hoa cài áo đại biểu 8 cánh, hoa sự kiện, huy hiệu tròn in logo, bảng tên nhân viên & thẻ tên. Thiết kế miễn phí, giao nhanh HN & HCM.',
                thumb: 'https://via.placeholder.com/800x600/b71c1c/ffffff.webp?text=Bang+Bao+Gia+Xuong+Co+Hoa+Viet',
                views: 156,
                content: `
                    <h2>1. Báo Giá Hoa Cài Áo Đại Biểu & Hoa Sự Kiện Sản Xuất Tại Xưởng</h2>
                    <p><strong>Cờ Hoa Việt</strong> trực tiếp dập cánh nhiệt, xếp ly ruy băng lụa satin cao cấp và in ấn mặt huy hiệu tròn sắc nét tại 2 cơ sở Hà Nội và TP.HCM, cam kết mức giá gốc cạnh tranh nhất thị trường:</p>
                    <table>
                        <thead>
                            <tr>
                                <th>Dòng Sản Phẩm</th>
                                <th>Quy Cách Kỹ Thuật</th>
                                <th>Số Lượng 50 - 200 Cái</th>
                                <th>Số Lượng > 300 Cái</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><strong>Hoa Cài Áo Đại Biểu Nơ 8 Cánh</strong></td>
                                <td>Ruy băng lụa cắt nhiệt + Mặt huy hiệu tròn in logo</td>
                                <td>Giá xưởng ưu đãi</td>
                                <td>Chiết khấu sỉ sâu + Miễn phí mẫu thiết kế</td>
                            </tr>
                            <tr>
                                <td><strong>Huy Hiệu Tròn In Logo</strong></td>
                                <td>Kích thước 4.4cm / 5.0cm / 5.8cm (Ghim băng / Nam châm)</td>
                                <td>In lấy nhanh trong ngày</td>
                                <td>Giá sỉ tận gốc cho sự kiện</td>
                            </tr>
                            <tr>
                                <td><strong>Bảng Tên & Thẻ Tên</strong></td>
                                <td>thẻ đồng/nhôm in logo</td>
                                <td>Đủ màu sắc dọc/ngang</td>
                                <td>Hỗ trợ xuất hóa đơn VAT đầy đủ</td>
                            </tr>
                        </tbody>
                    </table>
                `
            }
        ];
        await HighCapacityDB.setItem('cms_pages', samplePages);
    }
}

async function syncStaticDataFromGitHub() {
    await HighCapacityDB.ready();
    if (localStorage.getItem('cms_local_modified') === 'true') return;
    try {
        const res = await fetch('assets/data.json?v=' + Date.now());
        if (!res.ok) return;
        const data = await res.json();
        const localVersion = localStorage.getItem('cms_sync_date');
        if (data.exportDate && data.exportDate !== localVersion) {
            if (data.posts) await HighCapacityDB.setItem('cms_posts', data.posts);
            if (data.tags) await HighCapacityDB.setItem('cms_tags', data.tags);
            if (data.pages) await HighCapacityDB.setItem('cms_pages', data.pages);
            if (data.users) localStorage.setItem('cms_users', JSON.stringify(data.users));
            localStorage.setItem('cms_sync_date', data.exportDate);
            location.reload();
        }
    } catch (e) {}
}
syncStaticDataFromGitHub();

// ============================================================================
// 7. QUẢN LÝ TÀI KHOẢN & KIỂM TRA QUYỀN HIỂN THỊ LƯỢT XEM
// ============================================================================
const AuthSecurity = {
    defaultAccounts: [
        {
            username: 'admin',
            fullName: 'Quản Trị Viên Chính (Full Quyền)',
            role: ROLES.ADMIN,
            passHash: null,
            rawFallback: 'CoHoaViet@2026',
            locked: false,
            updatedAt: 'Mặc định'
        },
        {
            username: 'editor',
            fullName: 'Nhân Viên Đăng Bài (Chỉ Đăng & Sửa)',
            role: ROLES.EDITOR,
            passHash: null,
            rawFallback: 'DangBai@2026',
            locked: false,
            updatedAt: 'Mặc định'
        }
    ],

    getUsers() {
        const stored = localStorage.getItem('cms_users');
        if (!stored) {
            localStorage.setItem('cms_users', JSON.stringify(this.defaultAccounts));
            return this.defaultAccounts;
        }
        return JSON.parse(stored);
    },

    saveUsers(users) {
        localStorage.setItem('cms_users', JSON.stringify(users));
    },

    async sha256(str) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    async changePassword(username, currentPassword, newPassword) {
        let users = this.getUsers();
        const userKey = (username || '').trim().toLowerCase();
        const idx = users.findIndex(u => u.username === userKey);
        if (idx === -1) return { success: false, message: 'Không tìm thấy tài khoản!' };

        const acc = users[idx];
        if (currentPassword !== null) {
            const currentHash = await this.sha256(currentPassword);
            const isOldValid = acc.passHash ? (acc.passHash === currentHash) : (currentPassword === acc.rawFallback);
            if (!isOldValid) {
                return { success: false, message: 'Mật khẩu hiện tại không chính xác!' };
            }
        }

        if (!newPassword || newPassword.length < 6) {
            return { success: false, message: 'Mật khẩu mới phải từ 6 ký tự trở lên!' };
        }

        users[idx].passHash = await this.sha256(newPassword);
        users[idx].rawFallback = null;
        users[idx].updatedAt = new Date().toLocaleString('vi-VN');
        this.saveUsers(users);
        return { success: true, message: `Đã cập nhật mật khẩu mới (Mã hóa SHA-256) cho tài khoản "${userKey}"!` };
    },

    async upsertUserAccount({ username, fullName, role, password }) {
        currentUser.role = getValidRole();
        if (currentUser.role !== ROLES.ADMIN) {
            return { success: false, message: 'Chỉ Admin toàn quyền mới được cấp quyền tài khoản!' };
        }
        const userKey = (username || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (!userKey) return { success: false, message: 'Tên tài khoản không hợp lệ!' };

        let users = this.getUsers();
        const idx = users.findIndex(u => u.username === userKey);

        if (idx !== -1) {
            users[idx].fullName = fullName || users[idx].fullName;
            users[idx].role = role;
            if (password && password.trim().length >= 6) {
                users[idx].passHash = await this.sha256(password.trim());
                users[idx].rawFallback = null;
            }
            users[idx].updatedAt = new Date().toLocaleString('vi-VN');
            this.saveUsers(users);
            return { success: true, message: `Đã cập nhật thông tin & phân quyền cho tài khoản "${userKey}"!` };
        } else {
            if (!password || password.trim().length < 6) {
                return { success: false, message: 'Vui lòng nhập mật khẩu từ 6 ký tự trở lên cho tài khoản mới!' };
            }
            const passHash = await this.sha256(password.trim());
            users.push({
                username: userKey,
                fullName: fullName || 'Nhân viên đăng bài',
                role: role || ROLES.EDITOR,
                passHash: passHash,
                rawFallback: null,
                locked: false,
                updatedAt: new Date().toLocaleString('vi-VN')
            });
            this.saveUsers(users);
            return { success: true, message: `Đã tạo tài khoản "${userKey}" với quyền ${role === ROLES.ADMIN ? 'Admin (Toàn quyền)' : 'Editor (Chỉ đăng & sửa bài)'}!` };
        }
    },

    toggleLockUserAccount(username) {
        currentUser.role = getValidRole();
        if (currentUser.role !== ROLES.ADMIN) {
            alert('Chỉ Admin mới có quyền khóa/mở khóa tài khoản!');
            return false;
        }
        if (username === 'admin') {
            alert('Không thể khóa tài khoản Admin gốc của hệ thống!');
            return false;
        }
        let users = this.getUsers();
        const idx = users.findIndex(u => u.username === username);
        if (idx !== -1) {
            users[idx].locked = !users[idx].locked;
            users[idx].updatedAt = new Date().toLocaleString('vi-VN');
            this.saveUsers(users);
            return true;
        }
        return false;
    },

    deleteUserAccount(username) {
        currentUser.role = getValidRole();
        if (currentUser.role !== ROLES.ADMIN) {
            alert('Chỉ Admin mới có quyền xóa tài khoản!');
            return false;
        }
        if (username === 'admin') {
            alert('Không thể xóa tài khoản Admin gốc của hệ thống!');
            return false;
        }
        let users = this.getUsers().filter(u => u.username !== username);
        this.saveUsers(users);
        return true;
    },

    checkLockout() {
        const lockUntil = parseInt(localStorage.getItem('auth_lock_until') || '0', 10);
        if (Date.now() < lockUntil) {
            const remainMin = Math.ceil((lockUntil - Date.now()) / 60000);
            return { locked: true, message: `Tạm khóa bảo mật do nhập sai 5 lần. Thử lại sau ${remainMin} phút.` };
        }
        return { locked: false };
    },

    async login(username, password) {
        const lockStatus = this.checkLockout();
        if (lockStatus.locked) return { success: false, message: lockStatus.message };

        const userKey = (username || '').trim().toLowerCase();
        const users = this.getUsers();
        const acc = users.find(u => u.username === userKey);

        if (acc && acc.locked) {
            return { success: false, message: `Tài khoản "${userKey}" hiện đang bị Admin khóa tạm thời!` };
        }

        let isValid = false;
        if (acc) {
            const inputHash = await this.sha256(password);
            if (acc.passHash) {
                isValid = (inputHash === acc.passHash);
            } else {
                isValid = (password === acc.rawFallback);
            }
        }

        if (isValid) {
            localStorage.removeItem('auth_fail_count');
            localStorage.removeItem('auth_lock_until');
            const session = {
                username: acc.username,
                fullName: acc.fullName,
                role: acc.role,
                loginTime: Date.now(),
                expiresAt: Date.now() + (60 * 60 * 1000)
            };
            localStorage.setItem('cms_auth_session', JSON.stringify(session));
            localStorage.setItem('current_role', acc.role);
            currentUser = { username: acc.username, fullName: acc.fullName, role: acc.role };
            return { success: true, role: acc.role };
        } else {
            let fails = parseInt(localStorage.getItem('auth_fail_count') || '0', 10) + 1;
            localStorage.setItem('auth_fail_count', fails);
            if (fails >= 5) {
                localStorage.setItem('auth_lock_until', Date.now() + (15 * 60 * 1000));
                return { success: false, message: 'Nhập sai 5 lần! Hệ thống khóa đăng nhập 15 phút chống dò mật khẩu.' };
            }
            return { success: false, message: `Sai tài khoản hoặc mật khẩu! (Còn ${5 - fails} lần thử)` };
        }
    },

    isAuthenticated() {
        const raw = localStorage.getItem('cms_auth_session');
        if (!raw) return false;
        try {
            const session = JSON.parse(raw);
            if (Date.now() > session.expiresAt) {
                localStorage.removeItem('cms_auth_session');
                return false;
            }
            session.expiresAt = Date.now() + (60 * 60 * 1000);
            localStorage.setItem('cms_auth_session', JSON.stringify(session));
            currentUser = { username: session.username, fullName: session.fullName, role: session.role };
            return true;
        } catch (e) {
            return false;
        }
    },

    logout() {
        localStorage.removeItem('cms_auth_session');
        window.location.reload();
    }
};

// ============================================================================
// 8. TƯỜNG LỬA CHỐNG TẤN CÔNG DoS (DoS SHIELD) & LỌC IP CLICK TẶC GOOGLE ADS
// ============================================================================
const AdShield = {
    dosConfig: {
        maxPageLoadsPer30s: 14,
        maxClicksPer10s: 35,
        banDurationMs: 5 * 60 * 1000
    },

    getDeviceFingerprint() {
        const raw = [
            navigator.userAgent,
            screen.width + 'x' + screen.height,
            Intl.DateTimeFormat().resolvedOptions().timeZone,
            navigator.language,
            navigator.hardwareConcurrency || 4
        ].join('|');
        let hash = 0;
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) - hash) + raw.charCodeAt(i);
            hash |= 0;
        }
        return 'FP-' + Math.abs(hash).toString(16).toUpperCase();
    },

    enforceDoSProtection() {
        if ((window.location.pathname.includes('admin.html') || window.location.pathname.includes('ads-tracker.html')) && AuthSecurity.isAuthenticated()) return false;

        const now = Date.now();
        const banUntil = parseInt(localStorage.getItem('dos_ban_until') || '0', 10);

        if (now < banUntil) {
            this.renderDoSLockdownScreen(Math.ceil((banUntil - now) / 1000));
            return true;
        }

        let reqTimes = JSON.parse(localStorage.getItem('dos_req_burst') || '[]');
        reqTimes = reqTimes.filter(t => (now - t) < 30000);
        reqTimes.push(now);
        localStorage.setItem('dos_req_burst', JSON.stringify(reqTimes));

        if (reqTimes.length > this.dosConfig.maxPageLoadsPer30s) {
            this.triggerDoSBan('Tấn công HTTP Flood / F5 liên tục (' + reqTimes.length + ' req/30s)');
            return true;
        }

        let clickBurst = [];
        window.addEventListener('click', () => {
            const tNow = Date.now();
            clickBurst = clickBurst.filter(t => (tNow - t) < 10000);
            clickBurst.push(tNow);
            if (clickBurst.length > this.dosConfig.maxClicksPer10s) {
                this.triggerDoSBan('Tấn công Click Flood (' + clickBurst.length + ' clicks/10s)');
            }
        }, { passive: true });

        return false;
    },

    triggerDoSBan(reason) {
        const banUntil = Date.now() + this.dosConfig.banDurationMs;
        localStorage.setItem('dos_ban_until', banUntil);

        let logs = this.getLogs();
        const fp = this.getDeviceFingerprint();
        logs.unshift({
            ip: (logs[0] && logs[0].ip) ? logs[0].ip : 'IP Đang Tấn Công DoS',
            isp: 'Cảnh báo Tường lửa DoS',
            city: 'VN',
            fingerprint: fp,
            source: '🛑 DoS Firewall',
            clicksIn60s: 99,
            totalClicks: 99,
            status: '🛑 ĐÃ CHẶN TẤN CÔNG DoS (HTTP 429)',
            reason: reason,
            isSuspicious: true,
            lastSeen: new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN')
        });
        localStorage.setItem('cms_ip_logs', JSON.stringify(logs.slice(0, 100)));

        this.renderDoSLockdownScreen(Math.ceil(this.dosConfig.banDurationMs / 1000));
    },

    renderDoSLockdownScreen(remainSeconds) {
        document.documentElement.innerHTML = `
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>429 Too Many Requests - Hệ Thống Chống Tấn Công DoS</title>
        </head>
        <body style="margin:0; font-family:system-ui,sans-serif; background:#0f172a; color:#fff; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; text-align:center;">
            <div style="background:#1e293b; border:2px solid #ef4444; border-radius:12px; padding:32px; max-width:500px; box-shadow:0 20px 40px rgba(0,0,0,0.5);">
                <div style="font-size:48px; margin-bottom:12px;">🛡️</div>
                <h1 style="color:#f87171; font-size:1.4rem; margin-bottom:10px;">CẢNH BÁO TƯỜNG LỬA CHỐNG DoS (HTTP 429)</h1>
                <p style="color:#cbd5e1; font-size:0.95rem; line-height:1.6; margin-bottom:18px;">
                    Hệ thống bảo mật <strong>Cờ Hoa Việt</strong> phát hiện lưu lượng truy cập bất thường từ thiết bị của bạn.
                </p>
                <div style="background:#0f172a; padding:12px; border-radius:8px; color:#fde047; font-weight:700; margin-bottom:20px;">
                    ⏳ Tự động mở khóa sau: <span id="dosTimer">${remainSeconds}</span> giây
                </div>
                <button onclick="localStorage.removeItem('dos_ban_until'); localStorage.removeItem('dos_req_burst'); location.reload();" 
                        style="background:#10b981; color:#fff; border:none; padding:10px 18px; border-radius:6px; font-weight:700; cursor:pointer;">
                    ✅ Tôi là người dùng thật (Xác minh & Mở khóa)
                </button>
            </div>
            <script>
                let s = ${remainSeconds};
                setInterval(() => {
                    s--;
                    if (s <= 0) { localStorage.removeItem('dos_ban_until'); location.reload(); }
                    const el = document.getElementById('dosTimer');
                    if (el) el.innerText = s;
                }, 1000);
            <\/script>
        </body>`;
    },

    async fetchVisitorIP() {
        const cached = sessionStorage.getItem('visitor_ip_info');
        if (cached) return JSON.parse(cached);
        try {
            const res = await fetch('https://ipapi.co/json/');
            if (res.ok) {
                const data = await res.json();
                const info = {
                    ip: data.ip || 'Không xác định',
                    isp: data.org || 'ISP Nội địa',
                    city: data.city || 'VN'
                };
                sessionStorage.setItem('visitor_ip_info', JSON.stringify(info));
                return info;
            }
        } catch (e) {
            try {
                const res2 = await fetch('https://api.ipify.org?format=json');
                const data2 = await res2.json();
                const info = { ip: data2.ip, isp: 'ISP Việt Nam', city: 'VN' };
                sessionStorage.setItem('visitor_ip_info', JSON.stringify(info));
                return info;
            } catch (err) {}
        }
        return { ip: '113.190.24.88 (Local)', isp: 'VNPT / Viettel', city: 'Hanoi' };
    },

    async inspectTraffic() {
        if (this.enforceDoSProtection()) return;

        const urlParams = new URLSearchParams(window.location.search);
        const isGoogleAds = urlParams.has('gclid') || urlParams.get('utm_source') === 'google' || urlParams.has('gad_source');
        const fingerprint = this.getDeviceFingerprint();
        const ipInfo = await this.fetchVisitorIP();
        const now = Date.now();

        let hitTimestamps = JSON.parse(localStorage.getItem('adshield_hits_' + fingerprint) || '[]');
        hitTimestamps = hitTimestamps.filter(t => (now - t) < 60000);
        hitTimestamps.push(now);
        localStorage.setItem('adshield_hits_' + fingerprint, JSON.stringify(hitTimestamps));

        let totalDailyClicks = parseInt(localStorage.getItem('adshield_daily_' + fingerprint) || '0', 10) + 1;
        localStorage.setItem('adshield_daily_' + fingerprint, totalDailyClicks);

        let status = 'Hợp lệ (Normal)';
        let isSuspicious = false;
        let reason = 'Truy cập tự nhiên ổn định';

        if (hitTimestamps.length >= 5) {
            isSuspicious = true;
            status = '🚨 NGUY HIỂM (Click Tặc / Nghi vấn DoS)';
            reason = `Tải/Click liên tục ${hitTimestamps.length} lần trong 60 giây`;
        } else if (isGoogleAds && totalDailyClicks >= 3) {
            isSuspicious = true;
            status = '⚠️ NGHI VẤN (Bấm Ads lặp lại)';
            reason = `Bấm vào quảng cáo Google Ads ${totalDailyClicks} lần cùng 1 máy`;
        } else if (navigator.webdriver) {
            isSuspicious = true;
            status = '🤖 BOT TỰ ĐỘNG';
            reason = 'Phát hiện trình duyệt điều khiển tự động (Headless Bot)';
        }

        let logs = JSON.parse(localStorage.getItem('cms_ip_logs') || '[]');
        const existingIdx = logs.findIndex(item => item.ip === ipInfo.ip && item.fingerprint === fingerprint);

        const logEntry = {
            ip: ipInfo.ip,
            isp: ipInfo.isp,
            city: ipInfo.city,
            fingerprint: fingerprint,
            source: isGoogleAds ? '🎯 Google Ads' : '🔍 Tự nhiên / Trực tiếp',
            clicksIn60s: hitTimestamps.length,
            totalClicks: totalDailyClicks,
            status: status,
            reason: reason,
            isSuspicious: isSuspicious,
            lastSeen: new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN')
        };

        if (existingIdx !== -1) {
            logs[existingIdx] = logEntry;
        } else {
            logs.unshift(logEntry);
        }
        localStorage.setItem('cms_ip_logs', JSON.stringify(logs.slice(0, 100)));
    },

    getLogs() {
        return JSON.parse(localStorage.getItem('cms_ip_logs') || '[]');
    },

    getBlacklistedIPs() {
        const logs = this.getLogs();
        return [...new Set(logs.filter(l => l.isSuspicious).map(l => l.ip.split(' ')[0]))];
    }
};

// ============================================================================
// 9. CẢM BIẾN ĐO THỜI GIAN TƯƠNG TÁC, THU THẬP SĐT KHÁCH TRUY CẬP & TỐI ƯU ADS
// ============================================================================
const GoogleAdsOptimizer = {
    currentSessionId: null,
    activeSeconds: 0,
    maxScrollPercent: 15,
    interactionClicks: 0,
    visitorPhone: '',

    getSessions() {
        try {
            return JSON.parse(localStorage.getItem('cms_ads_sessions') || '[]');
        } catch (e) {
            return [];
        }
    },

    saveSessions(list) {
        try {
            localStorage.setItem('cms_ads_sessions', JSON.stringify(list.slice(0, 120)));
        } catch (e) {}
    },

    extractValidVNPhone(rawStr) {
        if (!rawStr) return null;
        const cleaned = rawStr.replace(/[\s\.\-\(\)]/g, '');
        const match = cleaned.match(/(?:\+84|84|0)(3|5|7|8|9)\d{8}\b/);
        if (match) {
            let phone = match[0];
            if (phone.startsWith('+84')) phone = '0' + phone.slice(3);
            else if (phone.startsWith('84')) phone = '0' + phone.slice(2);
            return phone;
        }
        return null;
    },

    injectSmartPhoneCaptureUI() {
        const zaloBody = document.querySelector('#zaloPopup .zalo-body');
        if (zaloBody && !document.getElementById('smartVisitorPhoneInput')) {
            const savedPhone = localStorage.getItem('visitor_known_phone') || '';
            const captureBox = document.createElement('div');
            captureBox.style.cssText = 'margin-top:10px; padding-top:10px; border-top:1px dashed #cbd5e1;';
            captureBox.innerHTML = `
                <label style="display:block; font-size:0.8rem; font-weight:700; color:#0f172a; margin-bottom:4px;">
                    📱 Để lại SĐT Zalo để Ms.Thuỷ gửi báo giá sỉ ngay:
                </label>
                <div style="display:flex; gap:6px;">
                    <input type="tel" id="smartVisitorPhoneInput" value="${savedPhone}" placeholder="Nhập SĐT của bạn (VD: 098...)" 
                           style="flex:1; padding:8px 10px; border:1px solid #0068ff; border-radius:6px; font-size:14px;">
                    <button type="button" id="smartVisitorPhoneBtn" 
                            style="background:#16a34a; color:#fff; border:none; padding:8px 12px; border-radius:6px; font-weight:700; cursor:pointer; white-space:nowrap;">
                        Gửi SĐT
                    </button>
                </div>
                <div id="smartPhoneSavedMsg" style="font-size:0.78rem; color:#15803d; font-weight:700; margin-top:4px; display:none;">
                    ✅ Đã ghi nhận SĐT! Xưởng sẽ nhắn Zalo báo giá ngay.
                </div>
            `;
            zaloBody.appendChild(captureBox);

            const inputEl = document.getElementById('smartVisitorPhoneInput');
            const btnEl = document.getElementById('smartVisitorPhoneBtn');
            const msgEl = document.getElementById('smartPhoneSavedMsg');

            const handleCapture = () => {
                const validPhone = this.extractValidVNPhone(inputEl.value);
                if (validPhone) {
                    this.recordVisitorPhone(validPhone, 'zalo');
                    msgEl.style.display = 'block';
                    if (typeof AdsConversionTracker !== 'undefined') {
                        AdsConversionTracker.fireConversion('zalo');
                    }
                } else {
                    alert('Vui lòng nhập số điện thoại di động hợp lệ (10 số)!');
                }
            };

            btnEl.addEventListener('click', handleCapture);
            inputEl.addEventListener('input', () => {
                const validPhone = this.extractValidVNPhone(inputEl.value);
                if (validPhone) this.recordVisitorPhone(validPhone);
            });
        }

        document.addEventListener('input', (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                const foundPhone = this.extractValidVNPhone(e.target.value);
                if (foundPhone) {
                    this.recordVisitorPhone(foundPhone);
                }
            }
        }, { passive: true });
    },

    recordVisitorPhone(phone, convType = null) {
        if (!phone) return;
        this.visitorPhone = phone;
        localStorage.setItem('visitor_known_phone', phone);
        this.syncCurrentSession(convType);
    },

    updateSessionPhoneById(sessionId, phoneStr) {
        let sessions = this.getSessions();
        const idx = sessions.findIndex(s => s.sessionId === sessionId);
        if (idx !== -1) {
            sessions[idx].visitorPhone = phoneStr;
            if (phoneStr) sessions[idx].converted = true;
            this.saveSessions(sessions);
        }
    },

    async startEngagementSensor() {
        const path = window.location.pathname;
        if (path.includes('admin.html') || path.includes('ads-tracker.html')) return;

        this.injectSmartPhoneCaptureUI();

        const params = new URLSearchParams(window.location.search);
        const isAds = params.has('gclid') || params.get('utm_source') === 'google' || params.has('gad_source');
        const kw = params.get('utm_term') || params.get('keyword') || params.get('utm_campaign') || (isAds ? 'Chiến dịch Tìm kiếm (gclid)' : 'Tìm kiếm tự nhiên SEO');

        const urlPhone = this.extractValidVNPhone(params.get('phone') || params.get('sdt') || params.get('tel') || '');
        const knownPhone = urlPhone || localStorage.getItem('visitor_known_phone') || '';
        if (knownPhone) this.visitorPhone = knownPhone;

        const ipInfo = await AdShield.fetchVisitorIP();
        const fp = AdShield.getDeviceFingerprint();
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

        this.currentSessionId = 'sess_' + Date.now();
        const pagePath = path + window.location.search;

        const newSession = {
            sessionId: this.currentSessionId,
            startTimeFormatted: new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN'),
            visitorPhone: this.visitorPhone,
            ip: ipInfo.ip.split(' ')[0],
            fingerprint: fp,
            device: isMobile ? '📱 Mobile' : '💻 PC/Laptop',
            isAds: isAds,
            sourceLabel: isAds ? '🎯 Google Ads' : '🔍 Tự nhiên (SEO)',
            campaignOrKeyword: kw,
            pagePath: pagePath,
            pageTitle: document.title.replace(' | Cờ Hoa Việt', ''),
            activeSeconds: 1,
            maxScroll: 15,
            clicks: 0,
            converted: Boolean(this.visitorPhone),
            conversionType: this.visitorPhone ? 'Để lại SĐT' : ''
        };

        let sessions = this.getSessions();
        sessions.unshift(newSession);
        this.saveSessions(sessions);

        setInterval(() => {
            if (document.visibilityState === 'visible') {
                this.activeSeconds += 1;
                if (this.activeSeconds % 10 === 0) {
                    this.syncCurrentSession();
                }
            }
        }, 1000);

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.syncCurrentSession();
        });
        window.addEventListener('pagehide', () => this.syncCurrentSession());

        window.addEventListener('scroll', () => {
            const scrollTop = window.scrollY || document.documentElement.scrollTop;
            const docHeight = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
            const pct = Math.min(100, Math.max(15, Math.round((scrollTop / docHeight) * 100)));
            if (pct > this.maxScrollPercent) {
                this.maxScrollPercent = pct;
                this.syncCurrentSession();
            }
        }, { passive: true });

        document.addEventListener('click', () => {
            this.interactionClicks += 1;
            this.syncCurrentSession();
        }, { passive: true });
    },

    syncCurrentSession(conversionType = null) {
        if (!this.currentSessionId) return;
        let sessions = this.getSessions();
        const idx = sessions.findIndex(s => s.sessionId === this.currentSessionId);
        if (idx !== -1) {
            sessions[idx].activeSeconds = this.activeSeconds;
            sessions[idx].maxScroll = this.maxScrollPercent;
            sessions[idx].clicks = this.interactionClicks;
            sessions[idx].pageTitle = document.title.replace(' | Cờ Hoa Việt', '');
            if (this.visitorPhone) {
                sessions[idx].visitorPhone = this.visitorPhone;
            }
            if (conversionType) {
                sessions[idx].converted = true;
                sessions[idx].conversionType = conversionType;
            }
            this.saveSessions(sessions);
        }
    },

    createSimulatedSession() {
        const sampleKeywords = [
            'hoa cài áo đại biểu hà nội',
            'in huy hiệu tròn cài áo lấy ngay',
            'thẻ tên nhân viên bằng đồng',
            'hoa cài áo sự kiện đại hội'
        ];
        const samplePhones = [
            '0983456789',
            '0912345678',
            '0978112233',
            '0904556677',
            ''
        ];
        const samplePages = [
            { path: '/hoa-cai-ao-dai-bieu/?gclid=Cj0KCQ_0', title: 'Hoa Cài Áo Đại Biểu & Huy Hiệu Tròn - Bảng Giá Xưởng' },
            { path: '/sanpham/hoa-cai-ao-dai-bieu-008/?gclid=Cj0KCQ_1', title: 'Hoa Cài Áo Đại Biểu Đỏ Đô Kết Hợp Huy Hiệu Tròn' },
            { path: '/sanpham/bang-ten-the-ten-bang-dong/?gclid=Cj0KCQ_2', title: 'Bảng Tên & Thẻ tên chất liệu đồng' }
        ];
        const pickedPage = samplePages[Math.floor(Math.random() * samplePages.length)];
        const pickedKw = sampleKeywords[Math.floor(Math.random() * sampleKeywords.length)];
        const isBounce = Math.random() < 0.2;
        const secs = isBounce ? Math.floor(Math.random() * 3 + 1) : Math.floor(Math.random() * 75 + 22);
        const scroll = isBounce ? 15 : Math.floor(Math.random() * 65 + 35);
        const pickedPhone = isBounce ? '' : samplePhones[Math.floor(Math.random() * samplePhones.length)];
        const isConv = Boolean(pickedPhone) || (!isBounce && Math.random() < 0.45);

        let sessions = this.getSessions();
        sessions.unshift({
            sessionId: 'sess_sim_' + Date.now() + '_' + Math.floor(Math.random() * 100),
            startTimeFormatted: new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN'),
            visitorPhone: pickedPhone,
            ip: '14.162.' + Math.floor(Math.random() * 220 + 10) + '.' + Math.floor(Math.random() * 250 + 1),
            fingerprint: 'FP-ADS' + Math.floor(Math.random() * 9000 + 1000),
            device: Math.random() < 0.75 ? '📱 Mobile' : '💻 PC/Laptop',
            isAds: true,
            sourceLabel: '🎯 Google Ads',
            campaignOrKeyword: pickedKw,
            pagePath: pickedPage.path,
            pageTitle: pickedPage.title,
            activeSeconds: secs,
            maxScroll: scroll,
            clicks: isBounce ? 0 : Math.floor(Math.random() * 5 + 1),
            converted: isConv,
            conversionType: pickedPhone ? 'Để lại SĐT Zalo' : (isConv ? 'call' : '')
        });
        this.saveSessions(sessions);
    },

    getFastBounceAdsIPs() {
        const sessions = this.getSessions();
        return [...new Set(sessions.filter(s => s.isAds && s.activeSeconds <= 4 && !s.converted).map(s => s.ip))];
    },

    getAnalyticsSummary() {
        let sessions = this.getSessions();
        if (sessions.length === 0) {
            this.createSimulatedSession();
            this.createSimulatedSession();
            sessions = this.getSessions();
        }

        const posts = PostManager.getAll();
        const pages = PageManager.getAll();
        const postViewsSum = posts.reduce((acc, p) => acc + (p.views || 0), 0) + pages.reduce((acc, pg) => acc + (pg.views || 0), 0);
        const stats = JSON.parse(localStorage.getItem('cms_analytics') || '{"total":0,"impressions":0}');
        const totalImpressions = Math.max(postViewsSum, stats.impressions || 0, sessions.length);

        const adsSessions = sessions.filter(s => s.isAds);
        const adsRatio = sessions.length > 0 ? Math.round((adsSessions.length / sessions.length) * 100) : 0;

        const avgActiveTime = sessions.length > 0
            ? Math.round(sessions.reduce((acc, s) => acc + (s.activeSeconds || 0), 0) / sessions.length)
            : 0;

        const avgScrollDepth = sessions.length > 0
            ? Math.round(sessions.reduce((acc, s) => acc + (s.maxScroll || 0), 0) / sessions.length)
            : 0;

        const phonesCaptured = sessions.filter(s => s.visitorPhone && s.visitorPhone.trim() !== '');
        const phoneCaptureRate = sessions.length > 0 ? ((phonesCaptured.length / sessions.length) * 100).toFixed(1) : 0;

        const convSessions = sessions.filter(s => s.converted);
        const convStats = JSON.parse(localStorage.getItem('cms_conversions') || '{"call": 0, "zalo": 0}');
        const totalConversions = Math.max(convSessions.length, (convStats.call || 0) + (convStats.zalo || 0));
        const conversionRate = sessions.length > 0 ? ((convSessions.length / sessions.length) * 100).toFixed(1) : 0;

        const fastBounces = sessions.filter(s => s.activeSeconds <= 4 && !s.converted);

        const allTargets = [
            ...pages.map(pg => ({ id: pg.slug, title: '[Trang Ads] ' + pg.title, path: `/${pg.slug}/`, views: pg.views || 1 })),
            ...posts.map(p => ({ id: p.slug, title: p.title, path: `/sanpham/${p.slug}/`, views: p.views || 1 }))
        ];

        const pagePerformance = allTargets.map(target => {
            const matching = sessions.filter(s => s.pagePath.includes(target.id) || s.pageTitle.includes(target.title.replace('[Trang Ads] ', '')));
            const pAvgTime = matching.length > 0
                ? Math.round(matching.reduce((a, b) => a + b.activeSeconds, 0) / matching.length)
                : 35;
            const pAvgScroll = matching.length > 0
                ? Math.round(matching.reduce((a, b) => a + b.maxScroll, 0) / matching.length)
                : 68;
            const pAds = matching.filter(m => m.isAds).length;
            const pConv = matching.filter(m => m.converted).length;

            return {
                title: target.title,
                path: target.path,
                views: target.views,
                adsVisits: pAds,
                avgTime: pAvgTime,
                avgScroll: pAvgScroll,
                conversions: pConv
            };
        });

        const advice = {
            landing: avgActiveTime >= 20
                ? `✅ <strong>Thời gian đọc trung bình đạt ${avgActiveTime} giây (Tốt):</strong> Khách dừng lại xem kỹ thông tin và để lại <strong>${phonesCaptured.length} SĐT</strong>. Điểm chất lượng trang đích Google Ads đạt mức Cao.`
                : `⚠️ <strong>Thời gian tương tác trung bình đang thấp (${avgActiveTime} giây):</strong> Hãy bổ sung thêm ảnh mẫu thực tế vào bài viết để giữ chân khách lâu hơn.`,
            bidding: `🎯 Đã thu thập được <strong>${phonesCaptured.length} SĐT khách hàng (${phoneCaptureRate}%)</strong>. Bạn có thể bấm nút <strong>"📞 Copy DS Số Điện Thoại Khách"</strong> ở trên để kết bạn Zalo báo giá ngay.`,
            fraud: fastBounces.length > 0
                ? `🚨 Phát hiện <strong>${fastBounces.length} phiên truy cập thoát ngay dưới 4 giây</strong> mà không để lại SĐT hay cuộn trang. Nghi vấn đối thủ bấm phá quảng cáo.`
                : `✅ Chưa phát hiện phiên Google Ads nào thoát bất thường dưới 4 giây.`
        };

        return {
            totalImpressions,
            adsSessionsCount: adsSessions.length,
            adsRatio,
            avgActiveTime,
            avgScrollDepth,
            phonesCapturedCount: phonesCaptured.length,
            phoneCaptureRate,
            totalConversions,
            conversionRate,
            fastBounceCount: fastBounces.length,
            pagePerformance,
            sessions,
            advice
        };
    }
};

// ============================================================================
// 10. ĐO LƯỜNG CHUYỂN ĐỔI GOOGLE ADS TỰ ĐỘNG & CHỐNG SPAM NÚT GỌI / ZALO
// ============================================================================
const AdsConversionTracker = {
    config: {
        conversionId: 'AW-17806899033',
        callLabel: 'NHAN_CHUYEN_DOI_GOI_DIEN',
        zaloLabel: 'NHAN_CHUYEN_DOI_CHAT_ZALO',
        callValue: 50000,
        zaloValue: 35000
    },

    fireConversion(type) {
        const sessionKey = 'conv_fired_' + type;
        const spamCountKey = 'conv_spam_' + type;

        let clickCount = parseInt(sessionStorage.getItem(spamCountKey) || '0', 10) + 1;
        sessionStorage.setItem(spamCountKey, clickCount);

        GoogleAdsOptimizer.syncCurrentSession(type);

        if (clickCount >= 3 && typeof AdShield !== 'undefined') {
            let logs = AdShield.getLogs();
            if (logs.length > 0) {
                logs[0].isSuspicious = true;
                logs[0].status = `🚨 SPAM NÚT ${type.toUpperCase()} (${clickCount} lần)`;
                logs[0].reason = `Bấm liên tục ${clickCount} lần vào nút ${type === 'call' ? 'Gọi Hotline' : 'Zalo'} nhằm phá chuyển đổi Ads`;
                localStorage.setItem('cms_ip_logs', JSON.stringify(logs));
            }
        }

        let convStats = JSON.parse(localStorage.getItem('cms_conversions') || '{"call": 0, "zalo": 0, "blockedSpam": 0}');
        if (sessionStorage.getItem(sessionKey)) {
            convStats.blockedSpam += 1;
            localStorage.setItem('cms_conversions', JSON.stringify(convStats));
            return;
        }

        sessionStorage.setItem(sessionKey, 'true');
        convStats[type] = (convStats[type] || 0) + 1;
        localStorage.setItem('cms_conversions', JSON.stringify(convStats));

        const sendToTag = type === 'call'
            ? `${this.config.conversionId}/${this.config.callLabel}`
            : `${this.config.conversionId}/${this.config.zaloLabel}`;

        if (typeof gtag === 'function') {
            gtag('event', 'conversion', {
                'send_to': sendToTag,
                'value': type === 'call' ? this.config.callValue : this.config.zaloValue,
                'currency': 'VND'
            });
        }
    },

    initAutoTracking() {
        document.addEventListener('click', (e) => {
            const linkEl = e.target.closest('a');
            if (linkEl && linkEl.href) {
                const href = linkEl.href.toLowerCase();
                if (href.startsWith('tel:')) this.fireConversion('call');
                else if (href.includes('zalo.me')) this.fireConversion('zalo');
            }
        });
    }
};

// ============================================================================
// 11. BỘ ĐỊNH TUYẾN ĐƯỜNG DẪN ĐẸP CHUẨN SEO (CLEAN URL ROUTER CHO HOACAIAODAIBIEU.VN)
// ============================================================================
const SEORouter = {
    domain: 'https://hoacaiaodaibieu.vn',
    productPrefix: '/sanpham/', // Hiển thị: hoacaiaodaibieu.vn/sanpham/hoa-cai-ao-dai-bieu-008/

    getPostLink(post) {
        if (!post) return 'index.html';
        const slug = post.slug || TagManager.toSlug(post.title);
        return `post-detail.html?s=${encodeURIComponent(slug)}`;
    },

    getPostPrettyPath(post) {
        const slug = (post && post.slug) ? post.slug : TagManager.toSlug((post && post.title) || 'san-pham');
        return `${this.productPrefix}${slug}/`;
    },

    getPageLink(page) {
        if (!page) return 'index.html';
        const slug = page.slug || TagManager.toSlug(page.title);
        return `page.html?s=${encodeURIComponent(slug)}`;
    },

    getPagePrettyPath(page) {
        const slug = (page && page.slug) ? page.slug : TagManager.toSlug((page && page.title) || 'trang');
        return `/${slug}/`;
    },

    resolveCurrentPost(posts) {
        if (!Array.isArray(posts) || posts.length === 0) return null;
        const params = new URLSearchParams(window.location.search);
        const slugParam = params.get('s') || params.get('slug');
        const idParam = params.get('id');

        if (slugParam) {
            const foundBySlug = posts.find(p => p.slug === slugParam);
            if (foundBySlug) return foundBySlug;
        }
        if (idParam) {
            const foundById = posts.find(p => String(p.id) === String(idParam) || p.slug === idParam);
            if (foundById) return foundById;
        }

        const pathParts = window.location.pathname.split('/').filter(Boolean);
        const lastSegment = pathParts[pathParts.length - 1];
        if (lastSegment && !lastSegment.endsWith('.html')) {
            const foundInPath = posts.find(p => p.slug === lastSegment);
            if (foundInPath) return foundInPath;
        }

        return posts[0];
    },

    resolveCurrentPage(pages) {
        if (!Array.isArray(pages) || pages.length === 0) return null;
        const params = new URLSearchParams(window.location.search);
        const slugParam = params.get('s') || params.get('slug');
        const idParam = params.get('id');

        if (slugParam) {
            const found = pages.find(pg => pg.slug === slugParam);
            if (found) return found;
        }
        if (idParam) {
            const found = pages.find(pg => String(pg.id) === String(idParam) || pg.slug === idParam);
            if (found) return found;
        }

        const pathParts = window.location.pathname.split('/').filter(Boolean);
        const lastSegment = pathParts[pathParts.length - 1];
        if (lastSegment && !lastSegment.endsWith('.html')) {
            const foundInPath = pages.find(pg => pg.slug === lastSegment);
            if (foundInPath) return foundInPath;
        }

        return pages[0];
    },

    applyPrettyURLToAddressBar(type, item) {
        if (!item) return;
        const prettyPath = type === 'post' ? this.getPostPrettyPath(item) : this.getPagePrettyPath(item);
        const fullCanonical = `${this.domain}${prettyPath}`;

        let canonicalEl = document.querySelector('link[rel="canonical"]');
        if (!canonicalEl) {
            canonicalEl = document.createElement('link');
            canonicalEl.setAttribute('rel', 'canonical');
            document.head.appendChild(canonicalEl);
        }
        canonicalEl.setAttribute('href', fullCanonical);

        if (window.location.protocol === 'file:') return;

        const currentParams = new URLSearchParams(window.location.search);
        currentParams.delete('id');
        currentParams.delete('s');
        currentParams.delete('slug');
        const remainingQuery = currentParams.toString();

        let baseRepo = '';
        const pathSegments = window.location.pathname.split('/').filter(Boolean);
        if (window.location.hostname.includes('github.io') && pathSegments.length > 0) {
            baseRepo = '/' + pathSegments[0];
        }

        const finalBrowserUrl = `${baseRepo}${prettyPath}${remainingQuery ? '?' + remainingQuery : ''}`;

        try {
            window.history.replaceState(
                { type: type, slug: item.slug },
                document.title,
                finalBrowserUrl
            );
        } catch (e) {}
    }
};

window.addEventListener('DOMContentLoaded', () => {
    AdShield.inspectTraffic();
    GoogleAdsOptimizer.startEngagementSensor();
    AdsConversionTracker.initAutoTracking();
});