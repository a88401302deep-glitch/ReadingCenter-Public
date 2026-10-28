# 新增入口與標題參考：本機驗證

## 範圍

承接 e190daf 的單書瀏覽管理入口減量；依使用者第二張參考，將新增書籍、一次閱讀及閱讀紀錄入口統一為霧玫瑰色膠囊、白字、細微漸層與陰影。新增書籍入口從純加號改為加號搭配文字。書籍表單與紀錄標題採圓潤系統字體、600字重；不宣稱與圖片同款，不下載字型、不複製品牌、吉祥物或背景。

產品修改：App.tsx、books.css、BookReadingCycles.tsx、ReadingCycleManager.tsx、ReadingRecordPopover.tsx、journal-layout.css、tokens.css。只影響介面，沒有資料服務、匯入或部署設定變更。

## 驗證

- 相關元件6檔27項通過：book-form-scope、book-form-rating、book-form-language、book-reading-cycles、reading-cycle-date、reading-cycle-date-edit。
- Chromium與WebKit共6項通過：book-quiet-browsing、reading-cycle，包含360／1440px、預設3個管理入口、完整新增儲存流程、無橫向溢出、新增表單儲存／取消可見、新增入口至少44px。
- 首輪截圖發現舊單書透明按鈕規則蓋掉新增底色；已排除create-action，加入實際漸層與高度檢查，修正後6項重新通過。
- TypeScript／正式建置、修改TS與TSX範圍ESLint、git diff --check通過。建置仍有既有sql.js外部化及大型chunk提示。
- 未執行完整程式套件、完整瀏覽器套件或CI；尚未push、PR、私人承接或部署。前批完整測試不能當成本提交的完整品質閘門。

## 本機驗收

截圖位於專案根目錄 `.local-dev/book-quiet-design/create-entry-360.png`、`create-book-360.png`、`create-record-360.png`，使用合成資料。執行本機preview後：

1. 首頁確認右下角新增書籍的文字膠囊入口。
2. 新增書籍→輸入書名，確認標題與固定可見儲存／取消。
3. 開啟合成書籍→管理閱讀，確認新增一次閱讀與新增紀錄樣式，取消後回到原有瀏覽模式。

下一個唯一優先：確認本機視覺後，將本批管理入口與新增樣式一起承接私人版本，完成發布前品質閘門。

## 發布前完整CI發現與修正

首次公開CI40734367408的程式175檔758項通過；瀏覽器113項通過、3項失敗（兩引擎360px分次閱讀、WebKit閱讀紀錄）。已在本機定向重現相同3項失敗：閱讀紀錄彈窗原本靠左側觸發器向左展開，超出單書視窗；新增膠囊變寬與標題換行後，新增按鈕落到被裁掉的區域。

修正僅限760px以下的閱讀紀錄彈窗：改為固定置中、左右保留1rem，內文寬度跟隨彈窗並保留捲動。既有reading-record測試加入彈窗四邊與新增按鈕位於可視範圍的斷言，不使用強制點擊或增加重試。修正後Chromium／WebKit共10項通過（book-reading-groups、reading-record、book-quiet-browsing），包含原3個失敗、桌面與新增流程；typecheck／build／範圍lint通過。修正版本須再完成現有完整CI；不宣稱首次全綠。
