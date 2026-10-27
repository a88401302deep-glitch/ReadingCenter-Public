import type { CreatorRole } from '../domain'

/** Public contributor identities verified against official author/publisher pages, 2026-10-03.
 * This resolves only the single URL stored in an author cell. It does not infer roles,
 * combine contributors, interpret publisher pages, or fetch arbitrary URLs in the browser.
 * Original URL evidence remains in the book's importSourceNotes.
 */
export const NOTION_AUTHOR_URL_EVIDENCE: Readonly<Record<string, string>> = {
  'https://readmoo.com/contributor/34403': '護玄',
  'https://readmoo.com/contributor/57492': '信濃川日出雄',
  'https://readmoo.com/contributor/94340': '千年雨',
  'https://readmoo.com/contributor/45803': '小野不由美',
  'https://readmoo.com/contributor/59300': '柯裕棻',
  'https://readmoo.com/contributor/33084': '李政亮',
  'https://readmoo.com/contributor/13398': '謝金魚',
  'https://readmoo.com/contributor/50597': '飯野亮一',
  'https://readmoo.com/contributor/55473': '辻村深月',
  'https://readmoo.com/contributor/109699': '馥閒庭',
  'https://readmoo.com/contributor/12916': '蔣竹山',
  'https://readmoo.com/contributor/71226': '維特多．沙博爾夫斯基',
  'https://readmoo.com/contributor/114236': '小西雅暉',
  'https://readmoo.com/contributor/12598': '蔡璧名',
  'https://readmoo.com/contributor/44507': '澀谷直人',
  'https://readmoo.com/contributor/136538': '實川えむ',
  'https://readmoo.com/contributor/107645': '安妮拉．亞菲',
  'https://readmoo.com/contributor/138626': '高森美由紀',
  'https://readmoo.com/contributor/87099': '趣哥',
  'https://readmoo.com/contributor/20070': '月翔',
  'https://readmoo.com/contributor/24759': '陳名珉',
  'https://readmoo.com/contributor/59656': '李純瑀',
  // Author-owned official profiles: the numeric identity is verified, not guessed from the URL.
  'http://www.jjwxc.net/oneauthor.php?authorid=4599954': '修喵啊修喵',
  'http://www.jjwxc.net/oneauthor.php?authorid=1697012': '拉棉花糖的兔子',
  // Publisher evidence: https://magcomi.com/episode/10834108156766384484
  'https://search.books.com.tw/search/query/key/%E7%B4%BA%E5%90%89/adv_author/1/': '紺吉',
  // Publisher evidence: https://www.shinchosha.co.jp/writer/5015/
  'https://search.books.com.tw/search/query/key/%E3%81%A4%E3%81%8F%E3%81%BF%E3%81%9A/adv_author/1/': 'つくみず',
  // Official bookstore author page (same exact search URL).
  'https://search.books.com.tw/search/query/key/%E6%A3%AE%E5%8D%9A%E5%97%A3/adv_author/1/': '森博嗣',
  'https://zh.wikipedia.org/zh-tw/%E6%A3%AE%E5%8D%9A%E5%97%A3': '森博嗣',
  // Publisher evidence: https://www.kodansha.co.jp/comic/products/0000007603
  'https://bookof.moe/s/AUT,%E5%B9%B8%E6%9D%91%E8%AA%A0/': '幸村誠',
  // Evidence: https://www.sanmin.com.tw/product/index/007170236
  "https://search.books.com.tw/search/query/key/%E5%85%8B%E9%BA%97%E7%B5%B2%E6%B1%80%E5%AE%89%EF%BC%8E%E9%87%8C%E7%89%B9/adv_author/1/": "克麗絲汀安．里特",
  // Evidence: https://read.douban.com/ebook/416574906/
  "https://search.books.com.tw/search/query/key/%E8%A4%9A%E7%9B%9F/adv_author/1/": "褚盟",
  // Evidence: https://www.kadokawa.co.jp/product/200609000184/
  "https://www.easyatm.com.tw/wiki/%E9%9B%A8%E5%AE%AE%E8%AB%92": "雨宮諒",
  // Evidence: https://www.andbooks.com.tw/book.php?book_sn=1825
  "https://search.books.com.tw/search/query/key/%E6%92%92%E8%BF%A6%E5%88%A9%E4%BA%9E%E2%80%A7%E8%A5%BF%E7%90%B4/adv_author/1/": "撒迦利亞‧西琴",
  // Evidence: https://www.kadokawa.co.jp/product/321804000057/
  "https://search.books.com.tw/search/query/key/%EF%BC%88%E6%97%A5%EF%BC%89%E3%82%82%E3%81%AE%E4%B9%85%E4%BF%9D/adv_author/1/": "もの久保",
  // Evidence: https://read.douban.com/ebook/158109413/
  "https://search.books.com.tw/search/query/key/%EF%BC%88%E6%8D%B7%E5%85%8B%EF%BC%89%E9%98%BF%E7%88%BE%E8%B1%90%E6%96%AF%E2%80%A2%E7%A9%86%E5%A4%8F/adv_author/1/": "阿爾豐斯•穆夏",
  // Evidence: https://ilixiangguo.cn/book/book/view/id/1775
  "https://book.douban.com/search/%E5%90%89%E4%BA%95%E5%BF%8D": "吉井忍",
  // Evidence: https://www.eslite.com/product/1001116991001884
  "https://www.eslite.com/search?author=WyLls7bnlLDojorlj7giXQ": "島田莊司",
  // Evidence: https://www.ghibli.jp/international/publications/
  "https://book.douban.com/search/%E9%93%83%E6%9C%A8%E6%95%8F%E5%A4%AB": "鈴木敏夫",
  // Evidence: https://www.ucd.com.tw/nh_bookView.jsp?cat_c=01&stk_c=9786267261972
  "https://search.books.com.tw/search/query/key/%E5%90%89%E5%9C%8B%E7%91%9E/adv_author/1/": "吉國瑞",
  // Evidence: https://www.bookrep.com.tw/?at=bookcontent&cl=book&id=14006&md=gwindex
  "https://www.kobo.com/tw/zh/author/%E6%AD%90%E6%96%87%EF%BC%8E%E5%A5%A7%E4%BE%83": "歐文．奧侃",
  // Evidence: https://www.kadokawa.co.jp/product/321210000074/
  "https://zh.wikipedia.org/wiki/%E5%A4%AA%E7%94%B0%E7%B4%AB%E7%B9%94": "太田紫織",
}

export function resolveNotionAuthorUrl(raw: string): string | null {
  // Only remove a list marker followed by whitespace; roles and any other added text defer.
  // Query strings are accepted only when the complete URL is explicitly verified above.
  const key = raw.trim().replace(/^•\s+/, '')
  return Object.hasOwn(NOTION_AUTHOR_URL_EVIDENCE, key) ? NOTION_AUTHOR_URL_EVIDENCE[key] : null
}


export interface VerifiedSourceAuthors { names: string[]; credits?: { name: string; role: CreatorRole }[] }
export interface AuthorSourceContext { title: string; sourceUrls: string[] }

function hasBookPage(urls: string[], page: string): boolean {
  return urls.some((raw) => {
    try {
      const url = new URL(raw)
      // Tracking is irrelevant only to this book-page guard; contributor URLs remain exact.
      return !url.username && !url.password && !url.hash && `${url.origin}${url.pathname}` === page
    } catch { return false }
  })
}

/** Public book-specific corrections. Publisher/profile IDs are NOT global author aliases. */
export function resolveNotionAuthorSource(raw: string, context: AuthorSourceContext): VerifiedSourceAuthors | null {
  const text = raw.trim()
  // Two coauthors verified: https://www.azothbooks.com/shop/8139
  if (text === "https://search.books.com.tw/search/query/key/%E5%8D%A1%E9%87%8C%E5%A7%86%E2%80%A7%E5%9F%83%E7%88%BE%EF%BC%8D%E9%AB%98%E5%93%88%E5%88%A9/adv_author/1/\n, https://search.books.com.tw/search/query/key/%E7%91%AA%E8%92%82%E7%88%BE%E5%BE%B7%E2%80%A7%E6%96%BD%E7%93%A6%E6%9C%AC%E5%BE%B7/adv_author/1/") return { names: ['卡里姆‧埃爾－高哈利', '瑪蒂爾德‧施瓦本德'] }
  // Coauthors verified: https://www.cna.com.tw/proj_goodbook/social-science/3000
  if (text === "https://readmoo.com/contributor/1573https://readmoo.com/contributor/63338") return { names: ['丘美珍', '鄭仲嵐'] }
  // Book credits supplied by 蓋亞文化: Google Play book HGQ7EAAAQBAJ.
  // Match the whole source cell AND this book, without guessing the four profile identities.
  if (text === "https://readmoo.com/contributor/76202 https://readmoo.com/contributor/55504 https://readmoo.com/contributor/76203  https://readmoo.com/contributor/18780" && context.title === '台灣都市傳說百科' && hasBookPage(context.sourceUrls, 'https://readmoo.com/book/210189946000101')) return { names: ['楊海彥', '謝宜安', '阮宗憲', '臺北地方異聞工作室'] }
  // https://www.avanguard.com.tw/m/2001-1609-652740%2Cc17011-1.php
  if (text === 'https://readmoo.com/publisher/189' && context.title === '簡明台灣人四百年' && hasBookPage(context.sourceUrls, 'https://readmoo.com/book/210103048000101')) return { names: ['史明'] }
  // Publisher: https://www.kadokawa.com.tw/products/9786264002769
  // Readmoo's own article links this exact book ID: https://news.readmoo.com/2025/08/22/250822-wesuji/
  if (text === 'https://readmoo.com/contributor/131877' && context.title === '發生在近畿某處的那些事' && hasBookPage(context.sourceUrls, 'https://readmoo.com/book/210340404000101')) return { names: ['背筋'] }
  // https://www.kadokawa.co.jp/product/321506000162/ and Taiwan ISBN 9789864736560 credits.
  if (text === "京極夏彥 https://readmoo.com/contributor/33714" && context.title === '薔薇十字叢書神社姬之森') return { names: ['京極夏彥', '春日みかげ'], credits: [{ name: '京極夏彥', role: 'original' }, { name: '春日みかげ', role: 'author' }] }
  return null
}
