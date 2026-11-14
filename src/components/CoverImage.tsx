import { useEffect, useState } from 'react';
import { ARTWORK } from '../data/catalog';
import { toProxiedImageUrl } from '../utils/playerEngine';

interface CoverImageProps {
  src?: string;
  alt: string;
  className?: string;
  fallbackSrc?: string;
}

export function CoverImage({
  src,
  alt,
  className = '',
  fallbackSrc = ARTWORK.englishVinyl,
}: CoverImageProps) {
  const resolved = toProxiedImageUrl(src) || fallbackSrc;
  const [imgSrc, setImgSrc] = useState(resolved);

  useEffect(() => {
    setImgSrc(toProxiedImageUrl(src) || fallbackSrc);
  }, [src, fallbackSrc]);

  return (
    <img
      src={imgSrc}
      alt={alt}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        if (src && /^https?:\/\//i.test(src) && imgSrc === src) {
          setImgSrc(
            `/api/music/image?url=${encodeURIComponent(src)}${alt ? `&title=${encodeURIComponent(alt)}` : ''}`
          );
        } else if (imgSrc !== fallbackSrc) {
          setImgSrc(fallbackSrc);
        }
      }}
      className={className}
    />
  );
}
