# 參考讀墨的分類與標籤選項

2026-10-30，基準公開main414f04e（私人已發布a9e21a6）。使用者要求分類、類型、標籤先提供可選清單，主要參考讀墨。本批唯一目標是可直接選用、保留既有資料的起始詞庫，非自動分類或遠端同步讀墨。

## 來源與範圍
- 主題分類13項：商業理財、文學小說、社會科學、生活風格、藝術設計、自然科普、勵志成長、醫療保健、旅遊觀光、教育、青少年與兒童、宗教、羅曼史／言情小說。
- 分類依讀墨官方活動頁全站分類的可見搜尋索引整理：https://readmoo.com/events/readmooxmwtrm/judge 。分類首頁與商品頁本次直接讀取遭403／驗證限制，不宣稱完整即時目錄。
- 25個標籤是本地整理的起始選項，參考官方閱讀最前線的主題用法，不宣稱等於讀墨商品全站標籤清單：推理、懸疑、驚悚、犯罪、本格推理、社會派推理、密室推理、都市傳說、奇幻、科幻、異世界、冒險、魔法、愛情、BL、GL、歷史、神話、成長、家庭、心理、哲學、投資、理財、人工智慧。
- 官方參考：https://news.readmoo.com/tag/本格推理/ 、https://news.readmoo.com/tag/奇幻/ 、https://news.readmoo.com/tag/異世界/ 、https://news.readmoo.com/tag/都市傳說/ 、https://news.readmoo.com/2025/07/07/2025hot/ 。各詞為本地編選，並非逐本已核對的內容推薦。
- 類型沿用既有資料模型的小說／漫畫／雜誌／網文／未設定（一般書籍）選項，不擴充資料schema；說明它是作品形式，推理／奇幻等題材歸標籤。分類與標籤可複選／留空，保留既有搜尋。頻率推薦標為「常用」。來源分組與書籍版本命名未混入本批。

## 儲存與保留
- 讀取表單只提供選項，不灌入全詞庫。只在使用者選取並儲存書籍時，於原書籍transaction建立必要dictionary；同kind同NFKC／trim／大小寫名稱重用既有ID，不改名稱、不合併歷史項目、不清空未知ID。
- 預設ID採book-term:kind:label，未知／跨kind預設或ID內容衝突拒絕。原來源、閱讀紀錄、封面及人工項目不變。沒有自動判讀書名、套標籤或改正式資料。
- 選單明確標籤及44px以上原生選取欄位；手機／iPad自然寬度，不新增折疊資料層。

## 驗證
- 22項單元／元件（term plan、book service、metadata plan、recommendations、form scope）通過。
- 8項整合／App（新詞庫IndexedDB transaction、既有book CRUD、cloud sync）通過；包含實際注入book save失敗，dictionary／book／sync outbox一起rollback，以及重新開庫與dictionary先於book排入同步佇列。
- 10個唯一Chromium／WebKit案例分層通過：6個既有768／1024／1366完整編輯＋4個360／1024預設分類標籤選取／複選／儲存／篩選／再次編輯／清除。最初4新案例找不到新隱式label，補明確aria-label後定位到既有類型label包含選項字串，測試改角色定位，4項最終通過。無force、放寬timeout或移除資料斷言。
- typecheck、範圍eslint、build、diff check通過。未完整CI／私人承接／推送／PR／發布。
- 合成預覽.local-dev/readmoo-term-design/term-choices-360.png及term-choices-1024.png；手機已目視。驗收：新增／編輯→分類與標籤下拉複選、類型選小說等→儲存後用書庫篩選核對，再開啟移除儲存。正式站未提供本批新清單。

下一個唯一優先任務：預覽確認後承接與完整CI，發布仍須另行授權。
