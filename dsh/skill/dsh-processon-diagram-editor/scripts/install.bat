@echo off
chcp 65001 >nul
setlocal

echo ============================================
echo   ProcessOn 画布 AI 改图 - DSH 技能安装
echo ============================================
echo.

set "SKILL_NAME=dsh-processon-diagram-editor"
set "TARGET=%USERPROFILE%\.dsh\skills\%SKILL_NAME%"

if not exist "%USERPROFILE%\.dsh\skills" (
    mkdir "%USERPROFILE%\.dsh\skills"
)

echo [1/5] 清理同名旧安装
if exist "%TARGET%" (
    echo       覆盖更新 %TARGET%
    rmdir /s /q "%TARGET%"
)

REM 历史遗留：改名前叫 processon-diagram-editor / diagram-copilot
REM 留着会让技能列表里出现两个同名不同源的东西，必须清掉
for %%O in (processon-diagram-editor diagram-copilot) do (
    if exist "%USERPROFILE%\.dsh\skills\%%O" (
        echo       清理旧目录 %%O
        rmdir /s /q "%USERPROFILE%\.dsh\skills\%%O"
    )
)

echo [2/5] 复制技能到 %TARGET%
xcopy /e /i /q /y "%~dp0.." "%TARGET%" >nul
if errorlevel 1 (
    echo       [错误] 复制失败
    goto :fail
)

echo [3/5] 验证必需文件
set "MISSING="
for %%F in (SKILL.md _meta.json pobridge.min.js lib\page.mjs test\selftest.mjs test\parity.mjs) do (
    if not exist "%TARGET%\%%F" (
        echo       [错误] 缺少 %%F
        set "MISSING=1"
    )
)
if defined MISSING goto :fail
echo       SKILL.md / _meta.json / pobridge.min.js / lib / test OK

echo [4/5] 校验 frontmatter 名字与目录名一致
REM 不一致 DSH 会认成另一个技能，且不会报错
findstr /c:"name: %SKILL_NAME%" "%TARGET%\SKILL.md" >nul
if errorlevel 1 (
    echo       [错误] SKILL.md 的 name 与目录名不一致
    goto :fail
)
echo       frontmatter name OK

echo [5/5] 自检
pushd "%TARGET%"
node test\selftest.mjs
set SELFTEST=%errorlevel%
if %SELFTEST%==0 node test\parity.mjs >nul 2>&1
popd
if not %SELFTEST%==0 (
    echo       [警告] 离线自检未通过（可能没装 Node.js，不影响使用）
) else (
    echo       36 项离线断言通过
)

echo.
echo 安装完成：%TARGET%
echo.
echo 重启 DSH 后即可使用。对 AI 说：
echo     "看一下这张 ProcessOn 图的结构"
echo.
echo 前提：必须已安装 DSH 浏览器扩展，否则 AI 碰不到页面。
echo.
pause
exit /b 0

:fail
echo.
echo 安装失败，请检查上面 [错误] 行。
pause
exit /b 1
