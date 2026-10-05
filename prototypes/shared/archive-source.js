/** Name the actual repository supplying a historical copy. */
export function archiveName(v) {
  const url = v?.archive_url || "";
  if (/^https:\/\/webarchive\.nationalarchives\.gov\.uk\//.test(url)) return "National Archives";
  if (/^https:\/\/(?:www\.)?ecoi\.net\//.test(url)) return "ecoi.net";
  if (/^https:\/\/(?:www\.)?refworld\.org\//.test(url)) return "Refworld";
  return "Internet Archive";
}
