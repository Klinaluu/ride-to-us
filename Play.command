#!/bin/bash
# Mở game qua server nội bộ (dùng khi trình duyệt chặn file://). Double-click là chạy.
cd "$(dirname "$0")"
PORT=8743
(sleep 1; open "http://localhost:$PORT/index.html") &
python3 -m http.server $PORT
