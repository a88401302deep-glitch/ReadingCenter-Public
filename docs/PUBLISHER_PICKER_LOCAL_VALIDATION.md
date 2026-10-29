# 出版社搜尋與既有名單選擇

2026-10-30，基準公開mainadd2e8c、私人正式d93694c；分支codex/publisher-picker。本批唯一目標為出版社可選且保留自由輸入，不建立或宣稱完整繁簡中文出版業名錄。

- 出版社原文字欄保留（供搜尋帶入、手動修改、新名稱或留空）；新增既有出版社原生選單，依輸入內容篩選，清空可看全部，明確顯示符合數與無符合狀態。
- 僅取dictionary publisher；展示同NFKC／trim／大小寫名稱去重，不刪除、不合併或改名既有dictionary。沒有繁簡轉換或出版集團／品牌猜測。
- 選取只更新同一草稿publisherName，沿用原book-metadata-plan同名查找與既有儲存transaction；沒有新增服務寫入路徑，打開表單或選擇不寫正式資料。手動新名稱只有儲存才新增，下次可用。
- 19項元件測試通過（publisher field、metadata search、form scope）；10項Chromium／WebKit通過（360／1024選用／新增／儲存回讀及其他書籍保留，768／1024／1366完整表單回歸）。typecheck／範圍eslint／build／diff check通過。合成圖.local-dev/publisher-picker-design/publisher-picker-360.png已目視，1024圖同目錄。
- 尚未私人承接／推送／PR／完整CI／部署，正式仍d93694c；未讀寫正式書籍、封面或私人名單。

驗收：新增或編輯→出版社輸入部分文字並選既有名稱→手動修正或輸入新名稱，儲存後重新開啟確認。下一個唯一優先任務：候選確認後承接與完整發布驗證。另記待辦：書籍版本／電子書與作品類型混用、未分類含義、來源重新分組；未因本出版社改動擅自改寫這些資料。
