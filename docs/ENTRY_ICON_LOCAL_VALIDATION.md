# 主要入口圖示：本機驗證

唯一目標：承接4c26caa，將閱讀、書庫、閱讀筆記與新增書籍入口改為圓潤、低飽和配色及輕微立體層次。保留文字標籤、位置與操作流程；搜尋、編輯、關閉等小型操作沿用原線稿。

使用原生SVG：翻頁書／書架／筆記本／圓形加號，玫瑰、鼠尾草綠與奶茶色；不新增圖片下載、外部服務、動畫或資料寫入。SVG為裝飾，aria-hidden且不取得焦點，按鈕提供原有可及名稱及目前頁面狀態。

修改產品5檔：src/shared/ui/EntryIcon.tsx、Header.tsx、src/app/App.tsx、src/shared/styles/journal-layout.css、tokens.css。其餘為既有app-shell E2E強化與此文件。

驗證結果：

- 開始前唯讀核對遠端公開main仍為bb91f99076c3621deb5b169bd1ec547dac612c99，沿用未發布候選分支。
- 元件2檔6項通過（header、app-library-reading）。
- Chromium／WebKit共8項通過（app-shell、book-quiet-browsing），包含360／1440px、導覽切換及aria-current、鍵盤Enter、至少44px點擊高度、無橫向溢出及新增書籍流程。
- TypeScript／正式建置、變更範圍ESLint及git diff --check通過。既有sql.js外部化／大型chunk提示仍存在；元件環境提示scrollTo未實作，未造成測試失敗。
- 合成資料手機／桌面截圖已目視檢視，保存在專案根目錄.local-dev/book-quiet-design/entry-icons-360.png及entry-icons-1440.png。無新的像素回歸基準聲明。
- 本輪未跑完整套件或CI；未push、PR、私人承接、合併或部署，尚無使用者實機驗收。

本機驗收步驟：

1. 首頁查看底部（手機）或頂部（桌面）的閱讀／書庫／閱讀筆記圖示與文字。
2. 切換三個入口，確認選取狀態及內容正常；鍵盤可聚焦並按Enter切換。
3. 點新增書籍，確認新圖示與表單能正常開啟及取消。

下一個唯一優先：將本批管理入口、字體、新增樣式及主要圖示承接私人版本，執行發布前品質閘門；此文件不構成正式發布或前批CI例外授權。
