# 出版品牌與書籍來源圖示修正

2026-10-29，基準公開main a85f909，分支codex/publisher-source-links。本次唯一目標：避免Google候選將出版集團／品牌混作出版社，單書來源不再顯示整串網址。

- Google解析原本直取volumeInfo.publisher。只對明確讀書共和國＋單一斜線＋非空品牌去除集團前綴，野人短名轉野人文化；集團單名、非本集團、多段不明格式原樣保留。不依書名猜測、不改既有書籍或人工資料，帶入仍經原候選核對流程。
- 野人文化名稱及集團從屬依官方出版社介紹：https://www.bookrep.com.tw/index.php?at=presscontent&cl=press&id=2&md=gwindex&page=1 。使用者照片為讀書共和國／野人，未向正式API讀取該私人書籍或即時Google回應；根因依現有直通解析與照片判斷。
- 書籍來源改44px書本圖示圓形連結；來源名稱title與aria-label、鍵盤焦點、新頁noopener noreferrer保留。編輯表單仍可修改完整網址。未知來源使用hostname提示，舊異常網址名稱解析失敗不阻斷整頁。

59項單元／元件通過（首次舊的集團名稱預期失敗，更新為正確品牌後通過）；10項Chromium／WebKit搜尋／帶入與圖示連結瀏覽器通過。typecheck／範圍lint／build／diff check通過，未跑完整CI。合成預覽.local-dev/publisher-source-design/source-icons.png已目視。

驗收：搜尋帶讀書共和國／野人的候選，核對出版社為野人文化後帶入；在單書頁點來源圖示，確認開啟原書頁；編輯可檢視完整網址。僅本機未私人承接／PR／部署，既有那本私人書未修改。下一個唯一優先任務：整合已保留排序8701064、手機標頭4f2fc84與本批候選，做完整發布驗證；正式發布另行授權。
