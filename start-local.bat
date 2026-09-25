@echo off
setlocal
call npm install
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
echo افتح من هذا الجهاز: http://localhost:3000
echo لمعرفة عنوان الشبكة نفذ ipconfig ثم افتح http://IP:3000 من الهاتف والايباد
call npm start
