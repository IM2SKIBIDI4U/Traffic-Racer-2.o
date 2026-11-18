// The model file is stored in Git LFS. GitHub Pages returns the small LFS
// pointer for a relative URL, so redirect Three.js' XHR loader to the LFS CDN.
(() => {
  const originalOpen = XMLHttpRequest.prototype.open;
  const trafficAsset = 'traffic_rider_npc_vehicles.glb';
  const actualAsset = 'https://media.githubusercontent.com/media/IM2SKIBIDI4U/Traffic-Racer-2.o/main/traffic_rider_npc_vehicles.glb';
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (typeof url === 'string' && url.split(/[?#]/, 1)[0].endsWith('/' + trafficAsset)) url = actualAsset;
    return originalOpen.call(this, method, url, ...rest);
  };
})();
