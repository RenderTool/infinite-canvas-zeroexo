import { useEffect, RefObject } from 'react';

interface UseMagneticEffectOptions {
  strength?: number;
  selector?: string;
}

export function useMagneticEffect(
  containerRef: RefObject<HTMLElement | null>,
  options: UseMagneticEffectOptions = {}
) {
  const { strength = 30, selector = 'button' } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const buttons = container.querySelectorAll<HTMLElement>(selector);
    const handlers = new Map<HTMLElement, { mousemove: (e: MouseEvent) => void; mouseleave: () => void }>();

    buttons.forEach((btn) => {
      const handleMouseMove = (e: MouseEvent) => {
        const rect = btn.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = Math.max(rect.width, rect.height) * 1.2;
        if (dist < maxDist) {
          const factor = (1 - dist / maxDist) * strength;
          btn.style.transform = `translate(${dx * factor / maxDist}px, ${dy * factor / maxDist}px)`;
        }
      };
      const handleMouseLeave = () => {
        btn.style.transform = 'translate(0,0)';
      };
      btn.addEventListener('mousemove', handleMouseMove);
      btn.addEventListener('mouseleave', handleMouseLeave);
      handlers.set(btn, { mousemove: handleMouseMove, mouseleave: handleMouseLeave });
    });

    return () => {
      handlers.forEach((h, btn) => {
        btn.removeEventListener('mousemove', h.mousemove);
        btn.removeEventListener('mouseleave', h.mouseleave);
      });
    };
  }, [containerRef, strength, selector]);
}