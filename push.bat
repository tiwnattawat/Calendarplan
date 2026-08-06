@echo off
echo Automatically pushing changes to GitHub...
git add .
set msg=Auto update %date% %time%
git commit -m "%msg%"
git push
echo Done!
pause
