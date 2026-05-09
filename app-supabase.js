// app-supabase.js — LINE記事本 Supabase 版
// 部署前把下方兩個變數換成你的 Supabase 專案資訊
//             (有網址和Publishable key就可以讀取資料庫)


const SUPABASE_URL = 'https://qixssnrbynszktzjzdwp.supabase.co';   // ← 換成你的
const SUPABASE_KEY = 'sb_publishable_i2pVLmcM0qkUJpj-rXj7JA_wbzsEaBT';                        // ← 換成你的 anon key/Publishable key

// ── Supabase REST API 小工具 ──
const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`
};

async function sbSelect(params = '') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/posts?${params}`, { headers });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

async function sbInsert(row) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify(row)
    });
    if (!res.ok) throw new Error(await res.text());
}

// ── Supabase Realtime（即時更新）──
function subscribeRealtime(onChange) {
    const ws = new WebSocket(
        `${SUPABASE_URL.replace('https', 'wss')}/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`
    );
    ws.onopen = () => {
        ws.send(JSON.stringify({
            topic: 'realtime:public:posts',
            event: 'phx_join',
            payload: { config: { broadcast: { self: true }, presence: { key: '' } } },
            ref: null
        }));
    };
    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.event === 'INSERT' || msg.event === 'UPDATE' || msg.event === 'DELETE') {
            onChange();
        }
    };
    return ws;
}

// ════════════════════════════════════════
// ── Canvas 壓縮圖片 → Base64 ──
// ════════════════════════════════════════
function compressImageToBase64(file) {
    return new Promise((resolve, reject) => {
        const MAX_SIDE = 800, QUALITY = 0.75;
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > MAX_SIDE || height > MAX_SIDE) {
                if (width >= height) { height = Math.round(height * MAX_SIDE / width); width = MAX_SIDE; }
                else { width = Math.round(width * MAX_SIDE / height); height = MAX_SIDE; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', QUALITY));
        };
        img.onerror = reject;
        img.src = url;
    });
}

// ════════════════════════════════════════
// ── 圖片預覽狀態 ──
// ════════════════════════════════════════
let pendingImages = [];
const MAX_IMAGES = 3;
const postList = document.getElementById('post-list');

function addImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (pendingImages.length >= MAX_IMAGES) { alert(`最多 ${MAX_IMAGES} 張`); return; }
    pendingImages.push({ file, objectURL: URL.createObjectURL(file) });
    renderImagePreviews();
}

function renderImagePreviews() {
    const container = document.getElementById('image-preview-container');
    container.innerHTML = '';
    pendingImages.forEach((item, i) => {
        const w = document.createElement('div');
        w.className = 'preview-thumb-wrapper';
        w.innerHTML = `<img src="${item.objectURL}" class="preview-thumb">
                       <button class="remove-thumb" onclick="window.removeImage(${i})">✕</button>`;
        container.appendChild(w);
    });
}

window.removeImage = (i) => {
    URL.revokeObjectURL(pendingImages[i].objectURL);
    pendingImages.splice(i, 1);
    renderImagePreviews();
};

document.getElementById('image-btn').addEventListener('click', () => document.getElementById('image-input').click());
document.getElementById('image-input').addEventListener('change', (e) => {
    Array.from(e.target.files).forEach(addImageFile); e.target.value = '';
});
document.getElementById('post-input').addEventListener('paste', (e) => {
    for (const item of e.clipboardData?.items || [])
        if (item.type.startsWith('image/')) addImageFile(item.getAsFile());
});
const postBox = document.querySelector('.post-box');
postBox.addEventListener('dragover', (e) => { e.preventDefault(); postBox.classList.add('drag-over'); });
postBox.addEventListener('dragleave', () => postBox.classList.remove('drag-over'));
postBox.addEventListener('drop', (e) => {
    e.preventDefault(); postBox.classList.remove('drag-over');
    Array.from(e.dataTransfer.files).forEach(addImageFile);
});

// ════════════════════════════════════════
// ── 1. 發佈貼文 ──
// ════════════════════════════════════════
document.getElementById('submit-btn').addEventListener('click', async () => {
    const content = document.getElementById('post-input').value;
    if (!content.trim() && pendingImages.length === 0) return;

    const btn = document.getElementById('submit-btn');
    btn.disabled = true; btn.textContent = '壓縮中...';

    try {
        const imageBase64s = await Promise.all(pendingImages.map(p => compressImageToBase64(p.file)));
        const tags = content.match(/#([^\s#]+)/g)?.map(t => t.slice(1)) || [];

        btn.textContent = '儲存中...';
        await sbInsert({
            content,
            tags,
            image_base64s: imageBase64s,
            link_preview: null,
            created_at: new Date().toISOString()
        });

        document.getElementById('post-input').value = '';
        pendingImages.forEach(p => URL.revokeObjectURL(p.objectURL));
        pendingImages = [];
        renderImagePreviews();
        loadPosts(currentFilter); // 發佈後立即更新
    } catch (e) {
        alert('發佈失敗: ' + e.message);
    } finally {
        btn.disabled = false; btn.textContent = '送出';
    }
});

// ════════════════════════════════════════
// ── 2. 載入與渲染貼文 ──
// ════════════════════════════════════════
let currentFilter = null;

async function loadPosts(filterTag = null) {
    currentFilter = filterTag;
    postList.innerHTML = '<div class="loading">載入中...</div>';

    try {
        let params = 'order=created_at.desc&limit=50';
        if (filterTag) {
            // Supabase array 查詢：tags 包含某值
            params += `&tags=cs.{${filterTag}}`;
            document.getElementById('active-filter').classList.remove('hidden');
            document.getElementById('current-tag').innerText = filterTag;
        } else {
            document.getElementById('active-filter').classList.add('hidden');
        }

        const posts = await sbSelect(params);
        postList.innerHTML = '';
        posts.forEach(renderPost);
    } catch (e) {
        postList.innerHTML = `<div style="padding:20px;color:red">載入失敗：${e.message}</div>`;
    }
}

function renderPost(data) {
    const card = document.createElement('div');
    card.className = 'post-card';

    let htmlContent = (data.content || '').replace(
        /#([^\s#]+)/g,
        '<span class="tag-link" onclick="filterByTag(\'$1\')">#$1</span>'
    );

    // 舊貼文的 linkPreview（從 Firestore 匯入的）
    let previewHtml = '';
    if (data.link_preview) {
        const lp = data.link_preview;
        previewHtml = `
            <a href="${lp.url}" target="_blank" class="link-preview">
                ${lp.image ? `<img src="${lp.image}" alt="preview">` : ''}
                <div class="link-info">
                    <strong>${lp.title || '連結預覽'}</strong>
                    <p>${lp.description || ''}</p>
                </div>
            </a>`;
    }

    // 圖片（Base64）
    let imagesHtml = '';
    if (data.image_base64s?.length > 0) {
        const imgs = data.image_base64s.map(b64 =>
            `<a href="${b64}" target="_blank"><img src="${b64}" class="post-image" loading="lazy"></a>`
        ).join('');
        imagesHtml = `<div class="post-images">${imgs}</div>`;
    }

    const time = data.created_at
        ? new Date(data.created_at).toLocaleString('zh-TW')
        : '傳送中...';

    card.innerHTML = `
        <div class="post-content">${htmlContent}</div>
        ${previewHtml}
        ${imagesHtml}
        <small style="color:#999">${time}</small>
    `;
    postList.appendChild(card);
}

// ════════════════════════════════════════
// ── 3. 搜尋邏輯 ──
// ════════════════════════════════════════
document.getElementById('search-btn').addEventListener('click', () => {
    const tag = document.getElementById('search-input').value.replace('#', '').trim();
    tag ? window.filterByTag(tag) : window.clearFilter();
});
document.getElementById('search-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('search-btn').click();
});

window.filterByTag = (tag) => loadPosts(tag);
window.clearFilter = () => loadPosts();

// ── Realtime 即時更新 ──
subscribeRealtime(() => loadPosts(currentFilter));

// 初始載入
loadPosts();
