// Standalone diagnostic tool - run this directly to test playlist reading
// without going through the website at all. Usage:
//
//   node test-playlist.js "https://www.youtube.com/playlist?list=XXXX"
//
// Prints exactly what each strategy does, in full detail, so if playlist
// adding still isn't working, this pinpoints exactly why.
const yt = require('./lib/youtube');

const url = process.argv[2];
if (!url) {
  console.log('Usage: node test-playlist.js "https://www.youtube.com/playlist?list=XXXX"');
  process.exit(1);
}

console.log(`Testing playlist URL: ${url}`);
console.log(`Node version: ${process.version}`);
console.log('---');

yt.fetchPlaylistItems(url)
  .then((result) => {
    if (!result) {
      console.log('No playlist ID could be extracted from that URL - is it really a playlist link?');
      return;
    }
    console.log('---');
    console.log(`SUCCESS - "${result.playlistTitle}" - ${result.items.length} videos found:`);
    result.items.slice(0, 5).forEach((item, i) => console.log(`  ${i + 1}. ${item.title}`));
    if (result.items.length > 5) console.log(`  ... and ${result.items.length - 5} more`);
  })
  .catch((err) => {
    console.log('---');
    console.log('FAILED. Error shown to the user would be:');
    console.log('  ' + err.message);
  });
