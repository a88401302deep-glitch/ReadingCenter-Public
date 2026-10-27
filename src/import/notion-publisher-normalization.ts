/** Storefront display names, not legal entity names. Keep every source value separately. */
export const NOTION_PUBLISHER_DISPLAY_RULES: Record<string, { displayName: string; evidenceUrl: string }> = {}

function add(displayName: string, evidenceUrl: string, aliases: string[]): void {
  for (const alias of aliases) NOTION_PUBLISHER_DISPLAY_RULES[alias] = { displayName, evidenceUrl }
}

add('東立', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=tongli', ['東立', '東立出版社'])
add('尖端', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=sharppnt', ['尖端', '尖端出版', '尖端出版社'])
add('青文', 'https://www.books.com.tw/web/sys_puballb/cebook/?pubid=chingwin', ['青文', '青文出版社'])
add('台灣東販', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=tohan', ['台灣東販', '台灣東販出版社', '台灣東販股份有限公司'])
add('皇冠', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=crown', ['皇冠', '皇冠文化', '皇冠文化有限公司', '皇冠文化出版有限公司', '• 皇冠文化有限公司'])
add('三采', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=suntriumph', ['三采文化', '三采文化股份有限公司'])
add('遠流', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=yuanliou', ['遠流出版', '遠流出版社'])
add('蓋亞', 'https://www.books.com.tw/web/sys_puballb/cebook/?pubid=gaea', ['蓋亞', '蓋亞文化'])
add('大田', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=titan', ['大田出版'])
add('台灣角川', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=kadokawa', ['台灣角川'])
add('長鴻出版社', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=everglory', ['長鴻出版社'])
add('新經典文化', 'https://www.books.com.tw/web/sys_pubtopm/books/?pubid=thinkingdom', ['新經典文化'])
add('商周出版', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=business', ['商周出版'])
add('麥浩斯', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=myhouse', ['麥浩斯'])
add('天下文化', 'https://www.books.com.tw/web/sys_puballb/cebook/?pubid=cwpc', ['天下文化'])
add('麥田', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=rye', ['麥田'])
add('時報出版', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=ctpubco', ['時報出版'])
add('獨步文化', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=apexcite', ['獨步文化'])
add('圓神', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=yuanshen', ['圓神出版'])
add('聯經出版公司', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=linking', ['聯經出版'])
add('木馬文化', 'https://www.books.com.tw/web/sys_puballb/books/?pubid=muma', ['木馬文化'])
add('馬可孛羅', 'https://www.books.com.tw/web/sys_pubnew/cebook/?pubid=marcopolo', ['馬可孛羅'])
add('奇幻基地', 'https://www.books.com.tw/web/sys_pubnew/store/?pubid=magicbase', ['奇幻基地'])
add('先覺', 'https://www.books.com.tw/products/E050151842', ['先覺出版'])
add('大塊文化', 'https://www.books.com.tw/products/0010927808', ['大塊文化'])
add('創意市集', 'https://pad.cite.com.tw/book?id=75273', ['創意市集'])

export function getNotionPublisherDisplayProposal(raw: string): { displayName: string; evidenceUrl: string } | null {
  return NOTION_PUBLISHER_DISPLAY_RULES[raw.trim()] ?? null
}
