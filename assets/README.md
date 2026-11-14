# Icon

`icon.svg` is the source of the extension icon. The PNG files in `public/icon/` (16, 32, 48, 96 and 128 pixels; WXT puts them into the manifest as `icons`, and the popup page names them as the toolbar icon) are rendered from it. Change the SVG, then render each size again, for example with Chrome (`chrome.exe` of your installation):

```
chrome --headless=new --hide-scrollbars --default-background-color=00000000 --window-size=SIZE,SIZE --screenshot=public/icon/SIZE.png page.html
```

where `page.html` shows `icon.svg` at SIZE by SIZE pixels (`<img src="icon.svg" width="SIZE" height="SIZE" style="display:block">`, body margin 0). The background must stay transparent.
