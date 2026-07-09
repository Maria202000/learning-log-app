# GitHub Pages 用ファイル

このフォルダの3ファイルをGitHub Pagesに置きます。

```text
endurance-version.html
endurance-version.js
collector-config.js
```

自動回収を使う場合は、先に `collector-config.js` を開いて、Google Apps ScriptのウェブアプリURLを貼ります。

```js
window.LEARNING_LOG_COLLECTOR_URL = "https://script.google.com/macros/s/ここにURL/exec";
```

URLを入れない場合でもアプリは動きますが、自動回収はされません。その場合は終了画面でCSVを保存して回収します。
