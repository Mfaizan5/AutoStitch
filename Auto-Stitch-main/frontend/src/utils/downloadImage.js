// Download an image to the user's device. A plain <a download> is ignored for
// cross-origin URLs, so fetch the image and save it from a blob instead.
export async function downloadImage(url, filename) {
  const res = await fetch(url, url.startsWith('data:') ? undefined : { credentials: 'include' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const name = filename.replace(/\.\w+$/, '') + '.' + ext;
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
