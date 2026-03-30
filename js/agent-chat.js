// ═══════════════════════════════════════════════════════════════
// Agent Chat Client - SSE 스트리밍 + 이미지 업로드
// ═══════════════════════════════════════════════════════════════

const API_BASE = (() => {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3200';
  // 프로덕션: Railway 배포 URL (환경별 설정)
  return window.__DADAM_API_BASE || 'https://dadam-api.up.railway.app';
})();

class AgentChat {
  constructor() {
    this.sessionId = null;
    this.isProcessing = false;

    // DOM 요소
    this.chatMessages = document.getElementById('chat-messages');
    this.chatInput = document.getElementById('chat-input');
    this.sendBtn = document.getElementById('send-btn');
    this.imageInput = document.getElementById('image-input');
    this.imagePreview = document.getElementById('image-preview');
    this.visualPanel = document.getElementById('visual-panel');
    this.imageGallery = document.getElementById('image-gallery');
    this.designInfo = document.getElementById('design-info');
    this.bomTable = document.getElementById('bom-table');
    this.svgViewer = document.getElementById('svg-viewer');
    this.tabBtns = document.querySelectorAll('.tab-btn');

    this.pendingImages = [];

    this.init();
  }

  init() {
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // 이미지 업로드
    document.getElementById('upload-btn').addEventListener('click', () => {
      this.imageInput.click();
    });
    this.imageInput.addEventListener('change', (e) => this.handleImageSelect(e));

    // 드래그앤드롭
    const dropZone = document.getElementById('chat-area');
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); this.handleDrop(e); });

    // 탭 전환 (모바일)
    this.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.showVisualTab(btn.dataset.tab);
      });
    });

    // 초기 메시지
    this.addBotMessage('안녕하세요! 다담AI 가구 설계 어시스턴트입니다.\n\n방 사진을 올려주시고, 원하시는 가구 종류를 말씀해주세요.\n\n지원 가구: 싱크대, 붙박이장, 냉장고장, 세면대, 신발장, 수납장');
  }

  async handleImageSelect(e) {
    const files = Array.from(e.target.files);
    for (const file of files) {
      await this.addPendingImage(file);
    }
    e.target.value = '';
  }

  async handleDrop(e) {
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    for (const file of files) {
      await this.addPendingImage(file);
    }
  }

  async addPendingImage(file) {
    const base64 = await this.fileToBase64(file);
    const imageEntry = { data: base64, mime_type: file.type };
    this.pendingImages.push(imageEntry);

    const preview = document.createElement('div');
    preview.className = 'preview-item';
    const img = document.createElement('img');
    img.src = `data:${file.type};base64,${base64}`;
    img.alt = '미리보기';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'preview-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      const idx = this.pendingImages.indexOf(imageEntry);
      if (idx !== -1) this.pendingImages.splice(idx, 1);
      preview.remove();
      if (this.pendingImages.length === 0) {
        this.imagePreview.style.display = 'none';
      }
    });
    preview.appendChild(img);
    preview.appendChild(removeBtn);
    this.imagePreview.appendChild(preview);
    this.imagePreview.style.display = 'flex';
  }

  fileToBase64(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.readAsDataURL(file);
    });
  }

  async sendMessage() {
    const message = this.chatInput.value.trim();
    if (!message && this.pendingImages.length === 0) return;
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.sendBtn.disabled = true;

    // 사용자 메시지 표시
    this.addUserMessage(message, this.pendingImages);

    const requestBody = {
      session_id: this.sessionId,
      message: message || '이 사진을 분석해주세요.',
      images: this.pendingImages.length > 0 ? this.pendingImages : undefined,
    };

    // 입력 초기화
    this.chatInput.value = '';
    this.pendingImages = [];
    this.imagePreview.innerHTML = '';
    this.imagePreview.style.display = 'none';

    // 봇 응답 영역 생성
    const botMsgEl = this.createBotMessageElement();
    const textEl = botMsgEl.querySelector('.msg-text');
    const progressEl = botMsgEl.querySelector('.msg-progress');

    try {
      const response = await fetch(`${API_BASE}/api/agent/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              this.handleSSEEvent(currentEvent, data, textEl, progressEl);
            } catch { /* skip malformed */ }
            currentEvent = '';
          }
        }
      }
    } catch (error) {
      textEl.textContent = `오류가 발생했습니다: ${error.message}`;
    } finally {
      this.isProcessing = false;
      this.sendBtn.disabled = false;
      progressEl.style.display = 'none';
      this.scrollToBottom();
    }
  }

  handleSSEEvent(event, data, textEl, progressEl) {
    switch (event) {
      case 'progress':
        this.handleProgress(data, progressEl);
        break;
      case 'text':
        if (data.chunk) {
          textEl.textContent += data.chunk;
        }
        break;
      case 'image':
        this.handleImage(data);
        break;
      case 'design_data':
        this.handleDesignData(data.design_data);
        break;
      case 'bom':
        this.handleBom(data.bom);
        break;
      case 'svg':
        this.handleSvg(data.svg);
        break;
      case 'done':
        if (data.session_id) {
          this.sessionId = data.session_id;
        }
        break;
      case 'error':
        textEl.textContent += `\n\n[오류] ${data.message}`;
        break;
    }
    this.scrollToBottom();
  }

  handleProgress(data, progressEl) {
    progressEl.style.display = 'block';
    const toolNames = {
      analyze_wall: '벽면 분석',
      search_design_rules: '설계 규칙 검색',
      render_furniture: '가구 이미지 생성',
      compute_layout: '레이아웃 계산',
      generate_bom: 'BOM 생성',
      generate_drawing: '도면 생성',
      render_svg: 'SVG 렌더링',
      save_design: '설계 저장',
      search_options: '옵션 검색',
      verify_image: '이미지 검증',
    };
    const name = toolNames[data.tool] || this.escapeHtml(data.tool || 'unknown');

    if (data.status === 'running') {
      progressEl.innerHTML = `<span class="spinner"></span> ${name} 진행중...`;
    } else if (data.status === 'complete') {
      const sec = data.duration_ms ? ` (${(data.duration_ms / 1000).toFixed(1)}s)` : '';
      progressEl.innerHTML = `<span class="check">✓</span> ${name} 완료${sec}`;
    } else if (data.status === 'error') {
      progressEl.innerHTML = `<span class="error-mark">✗</span> ${name} 실패`;
    }
  }

  handleImage(data) {
    const img = document.createElement('img');
    img.src = `data:${data.mime_type};base64,${data.base64}`;
    img.alt = data.label || '생성된 이미지';
    img.className = 'gallery-image';
    img.addEventListener('click', () => this.openLightbox(img.src));

    const label = document.createElement('span');
    label.className = 'gallery-label';
    label.textContent = data.label === 'closed_door' ? '닫힌문' : data.label === 'open_door' ? '열린문' : data.label;

    const wrapper = document.createElement('div');
    wrapper.className = 'gallery-item';
    wrapper.appendChild(img);
    wrapper.appendChild(label);

    this.imageGallery.appendChild(wrapper);
    this.showVisualTab('images');
  }

  handleDesignData(designData) {
    if (!designData) return;
    this.designInfo.innerHTML = '';

    const items = [
      ['카테고리', designData.category],
      ['스타일', designData.style],
      ['벽면', `${designData.wall?.width_mm}×${designData.wall?.height_mm}mm`],
      ['레이아웃', `${designData.layout?.total_width_mm}mm × ${designData.layout?.depth_mm}mm`],
      ['상부장', `${designData.cabinets?.upper?.length || 0}개`],
      ['하부장', `${designData.cabinets?.lower?.length || 0}개`],
      ['상판', designData.materials?.countertop],
      ['도어', `${designData.materials?.door_color} ${designData.materials?.door_finish}`],
      ['핸들', designData.materials?.handle_type],
    ];

    for (const [key, val] of items) {
      if (!val) continue;
      const row = document.createElement('div');
      row.className = 'info-row';
      row.innerHTML = `<span class="info-key">${key}</span><span class="info-val">${this.escapeHtml(String(val))}</span>`;
      this.designInfo.appendChild(row);
    }
  }

  handleBom(bom) {
    if (!bom || !bom.items) return;
    this.bomTable.innerHTML = '';

    // 요약
    const summary = document.createElement('div');
    summary.className = 'bom-summary';
    summary.textContent = `총 ${bom.summary?.total_items || bom.items.length}개 부품 | 원판 ${bom.summary?.sheet_estimate || '?'}장 예상`;
    this.bomTable.appendChild(summary);

    // 테이블
    const table = document.createElement('table');
    table.innerHTML = `
      <thead><tr><th>ID</th><th>부품명</th><th>자재</th><th>크기(mm)</th><th>수량</th></tr></thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    for (const item of bom.items) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${this.escapeHtml(String(item.id))}</td>
        <td>${this.escapeHtml(String(item.name))}</td>
        <td>${this.escapeHtml(String(item.material))}</td>
        <td>${this.escapeHtml(String(item.width_mm))}×${this.escapeHtml(String(item.height_mm))}</td>
        <td>${this.escapeHtml(String(item.quantity))}${this.escapeHtml(String(item.unit))}</td>
      `;
      tbody.appendChild(tr);
    }

    this.bomTable.appendChild(table);
    this.showVisualTab('bom');
  }

  handleSvg(svg) {
    if (!svg) return;
    this.svgViewer.innerHTML = '';

    const views = [
      ['front_view', '정면도'],
      ['side_view', '단면도'],
      ['plan_view', '평면도'],
      ['manufacturing', '제작도면'],
      ['installation', '설치도면'],
    ];

    for (const [key, label] of views) {
      if (!svg[key]) continue;
      const section = document.createElement('div');
      section.className = 'svg-section';
      section.innerHTML = `<h4>${label}</h4><div class="svg-container">${this.sanitizeSvg(svg[key])}</div>`;
      this.svgViewer.appendChild(section);
    }

    this.showVisualTab('drawings');
  }

  showVisualTab(tab) {
    document.querySelectorAll('.visual-content').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(`tab-${tab}`);
    if (target) target.classList.add('active');

    this.tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
  }

  addUserMessage(text, images) {
    const el = document.createElement('div');
    el.className = 'message user-message';

    let html = '';
    if (images?.length) {
      html += '<div class="msg-images">';
      for (const img of images) {
        html += `<img src="data:${img.mime_type};base64,${img.data}" class="msg-thumb">`;
      }
      html += '</div>';
    }
    if (text) {
      html += `<div class="msg-text">${this.escapeHtml(text)}</div>`;
    }

    el.innerHTML = html;
    this.chatMessages.appendChild(el);
    this.scrollToBottom();
  }

  addBotMessage(text) {
    const el = document.createElement('div');
    el.className = 'message bot-message';
    el.innerHTML = `<div class="msg-text">${this.escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
    this.chatMessages.appendChild(el);
    this.scrollToBottom();
  }

  createBotMessageElement() {
    const el = document.createElement('div');
    el.className = 'message bot-message';
    el.innerHTML = `
      <div class="msg-progress" style="display: none;"></div>
      <div class="msg-text"></div>
    `;
    this.chatMessages.appendChild(el);
    this.scrollToBottom();
    return el;
  }

  openLightbox(src) {
    const lb = document.getElementById('lightbox');
    lb.querySelector('img').src = src;
    lb.classList.add('active');
    lb.addEventListener('click', () => lb.classList.remove('active'), { once: true });
  }

  scrollToBottom() {
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  sanitizeSvg(svgString) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgString, 'image/svg+xml');
      const root = doc.documentElement;
      // script, foreignObject 제거
      root.querySelectorAll('script, foreignObject').forEach(el => el.remove());
      // 이벤트 핸들러 속성 및 javascript: URL 제거
      for (const el of root.querySelectorAll('*')) {
        for (const attr of Array.from(el.attributes)) {
          if (attr.name.startsWith('on') ||
              (typeof attr.value === 'string' && attr.value.toLowerCase().trim().startsWith('javascript:'))) {
            el.removeAttribute(attr.name);
          }
        }
      }
      return new XMLSerializer().serializeToString(root);
    } catch {
      return this.escapeHtml(svgString);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

let agentChat;
document.addEventListener('DOMContentLoaded', () => {
  agentChat = new AgentChat();
});
