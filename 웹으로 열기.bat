@echo off
chcp 65001 >nul
rem 이 .bat이 있는 폴더(앱 폴더)를 그대로 서버 루트로 사용 → 완전 상대경로, 어느 컴퓨터로 옮겨도 동작
cd /d "%~dp0"
echo.
echo  화음(畵音) - 로컬 서버 시작 (포트 4173)
echo  브라우저가 자동으로 열립니다.
echo  끄려면 이 창에서 Ctrl+C 를 누르거나 창을 닫으세요.
echo.
start "" "http://localhost:4173/index.html"
python -m http.server 4173 || py -m http.server 4173
