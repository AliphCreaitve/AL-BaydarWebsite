/**
 * Adds HTTP Range support to the static assets.
 *
 * Workers static assets answer a Range request with a plain 200 and the whole
 * file — no Accept-Ranges, no Content-Range. Browsers need 206 responses to
 * seek, so without this the video is stuck on its first frame and scrubbing
 * does nothing: video.currentTime is set, the browser can't fetch that offset,
 * and the picture never changes.
 *
 * Everything that isn't a ranged video request passes straight through.
 */

const RANGE = /^bytes=(\d*)-(\d*)$/;

export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);

    const type = res.headers.get('Content-Type') || '';
    const isMedia = type.startsWith('video/') || type.startsWith('audio/');
    if (!isMedia) return res;

    const range = request.headers.get('Range');

    // No range asked for: advertise that we support it, so the browser knows
    // it may seek rather than assuming the resource is unseekable.
    if (!range || res.status !== 200) {
      if (res.status === 200) {
        const headers = new Headers(res.headers);
        headers.set('Accept-Ranges', 'bytes');
        return new Response(res.body, { status: 200, headers });
      }
      return res;
    }

    const m = RANGE.exec(range.trim());
    if (!m) return res;

    const buf = await res.arrayBuffer();
    const size = buf.byteLength;

    let start, end;
    if (m[1] === '') {
      // Suffix form, "bytes=-N": the final N bytes. Players use this to read
      // the moov atom when it sits at the end of the file.
      const n = parseInt(m[2], 10);
      if (!Number.isFinite(n) || n <= 0) return res;
      start = Math.max(0, size - n);
      end = size - 1;
    } else {
      start = parseInt(m[1], 10);
      end = m[2] === '' ? size - 1 : parseInt(m[2], 10);
      if (end >= size) end = size - 1;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
      });
    }

    const headers = new Headers(res.headers);
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Length', String(end - start + 1));

    return new Response(buf.slice(start, end + 1), { status: 206, headers });
  },
};
