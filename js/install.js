// ============================================================
// Gợi ý cài game vào màn hình chính (chỉ hiện trên điện thoại / máy tính bảng).
//
// Ba tình huống:
//   1. Mở từ Messenger / Zalo / Instagram… → trình duyệt trong app không thêm được
//      vào màn hình chính, phải mở bằng Safari / Chrome trước.
//   2. iPhone / iPad + Safari → iOS không có API cài đặt, chỉ hướng dẫn thao tác.
//   3. Android + Chrome → dùng sự kiện beforeinstallprompt để bật hộp thoại cài thật.
// Máy tính không hiện gì (đã có nút toàn màn hình).
// ============================================================

const SEEN_KEY = "rtu-install-hint";
const SEEN_DAYS = 7;

// Trình duyệt nhúng trong các app nhắn tin / mạng xã hội
const IN_APP = /FBAN|FBAV|FB_IAB|Messenger|Instagram|Zalo|Line\/|MicroMessenger|TikTok|Twitter/i;
// Chrome (CriOS), Firefox (FxiOS), Edge (EdgiOS), Opera (OPiOS) trên iOS
const OTHER_IOS_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS/i;

export function detectPlatform(ua = navigator.userAgent, touch = matchMedia("(hover: none)").matches) {
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  if (!(ios || android || touch)) return "desktop";
  // Trình duyệt nhúng trong app nhắn tin: không thêm được vào màn hình chính
  if (IN_APP.test(ua)) return ios ? "in-app-ios" : "in-app";
  // iPhone/iPad: chỉ Safari mới có "Thêm vào MH chính"; Chrome/Firefox/Edge trên iOS thì không
  if (ios) return OTHER_IOS_BROWSER.test(ua) ? "ios-other" : "ios";
  return "android";
}

export function isInstalled() {
  return !!(window.navigator.standalone || matchMedia("(display-mode: standalone)").matches);
}

function seenRecently() {
  try {
    const ts = Number(localStorage.getItem(SEEN_KEY) || 0);
    return Date.now() - ts < SEEN_DAYS * 864e5;
  } catch (e) {
    return false;
  }
}

function remember() {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch (e) {
    /* chế độ riêng tư: bỏ qua */
  }
}

const COPY = {
  "in-app": {
    title: "MO_BANG_TRINH_DUYET",
    heading: "Mở bằng trình duyệt nhé",
    steps: [
      "Bấm dấu ••• ở góc trên màn hình",
      "Chọn “Mở bằng Chrome”",
      "Rồi thêm vào màn hình chính để chơi toàn màn hình",
    ],
    action: "Sao chép link",
  },
  "in-app-ios": {
    title: "MO_BANG_SAFARI",
    heading: "Mở bằng Safari nhé",
    steps: [
      "Bấm dấu ••• ở góc trên → “Mở bằng Safari”",
      "Không thấy mục đó thì bấm “Sao chép link” bên dưới, mở app Safari rồi dán vào ô địa chỉ",
      "Ở Safari: bấm nút Chia sẻ → “Thêm vào MH chính”",
    ],
    note: "Trên iPhone chỉ Safari mới thêm được vào màn hình chính (Chrome thì không có mục này).",
    action: "Sao chép link",
  },
  ios: {
    title: "THEM_VAO_MH_CHINH",
    heading: "Chơi như một app thật",
    steps: [
      "Bấm nút Chia sẻ ở thanh dưới của Safari",
      "Kéo xuống chọn “Thêm vào MH chính”",
      "Mở từ icon mới — toàn màn hình, không còn thanh địa chỉ",
    ],
    action: "Đã hiểu",
  },
  "ios-other": {
    title: "MO_BANG_SAFARI",
    heading: "Mở bằng Safari nhé",
    steps: [
      "Mở lại link này bằng app Safari — hoặc bấm “Sao chép link” bên dưới rồi dán vào ô địa chỉ của Safari",
      "Ở Safari: bấm nút Chia sẻ (ô vuông có mũi tên lên)",
      "Kéo xuống chọn “Thêm vào MH chính”",
    ],
    note: "Trên iPhone chỉ Safari mới thêm được vào màn hình chính (Chrome thì không có mục này).",
    action: "Sao chép link",
  },
  android: {
    title: "THEM_VAO_MH_CHINH",
    heading: "Chơi như một app thật",
    steps: [
      "Bấm “Cài ứng dụng” bên dưới",
      "Hoặc mở menu ⋮ rồi chọn “Cài ứng dụng”",
      "Mở từ icon mới — toàn màn hình, không còn thanh địa chỉ",
    ],
    action: "Cài ứng dụng",
  },
};

let deferredPrompt = null;

function buildModal(platform, text) {
  const copy = { ...COPY[platform], ...(text || {})[platform] };
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.id = "modal-install";
  modal.innerHTML = `
    <div class="win small">
      <div class="win-bar"><span>${copy.title}</span><button class="win-x btn" data-close>✕</button></div>
      <div class="win-body">
        <div class="install-heading">${copy.heading}</div>
        <ol class="install-steps">${copy.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
        ${copy.note ? `<p class="install-note">${copy.note}</p>` : ""}
        <button class="pixel-btn primary" data-action>${copy.action}</button>
        <input class="install-link hidden" data-link readonly value="${location.href}">
      </div>
    </div>`;
  return modal;
}

/**
 * Hiện gợi ý cài đặt nếu hợp lý.
 * @param {{text?: object, force?: boolean}} opts  text: chuỗi ghi đè theo từng nền tảng
 */
export function maybeShowInstallHint(opts = {}) {
  const platform = detectPlatform();
  if (platform === "desktop" || isInstalled()) return false;
  if (!opts.force && seenRecently()) return false;

  const modal = buildModal(platform, opts.text);
  const copyText = opts.text && opts.text.common;
  document.body.appendChild(modal);
  remember();

  const close = () => modal.remove();
  modal.querySelector("[data-close]").addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  const copiedLabel = (copyText && copyText.copied) || "Đã sao chép ✓";
  const action = modal.querySelector("[data-action]");
  action.addEventListener("click", async () => {
    if (platform === "android" && deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt = null;
      close();
      return;
    }
    if (platform.startsWith("in-app") || platform === "ios-other") {
      try {
        await navigator.clipboard.writeText(location.href);
        action.textContent = copiedLabel;
        return;
      } catch (e) {
        // không copy được (thường do trình duyệt trong app): hiện ô link để tự chọn
        const box = modal.querySelector("[data-link]");
        box.classList.remove("hidden");
        box.focus();
        box.setSelectionRange(0, box.value.length);
        return;
      }
    }
    close();
  });
  return true;
}

/** Gọi một lần lúc khởi động: bắt sự kiện cài đặt của Android và hẹn giờ hiện gợi ý. */
export function initInstallHint(opts = {}) {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // tự hiện hộp thoại của mình thay vì thanh mặc định
    deferredPrompt = e;
  });
  setTimeout(() => maybeShowInstallHint(opts), opts.delay ?? 1400);
}
