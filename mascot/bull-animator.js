/* Dependency-free component. Load as a normal script; works in local previews. */
(() => {
  const scriptBase = new URL('.', document.currentScript.src);
  const defaultSheet = new URL('bull-animations.png', scriptBase).href;
  const sequences = {
    idle: [[0,0,3200],[0,1,85],[0,2,110],[0,3,85],[0,0,1900]],
    wave: [[1,0,160],[1,1,140],[1,2,160],[1,3,140],[1,0,160],[1,1,140],[1,2,160],[1,3,140]],
    read: [[2,0,350],[2,1,180],[2,2,1400],[2,3,180],[2,0,450]],
    nod: [[3,0,180],[3,1,150],[3,2,200],[3,3,150],[3,0,350]]
  };
  class BullMascot extends HTMLElement {
    static get observedAttributes() { return ['state','src']; }
    constructor() {
      super();
      this.attachShadow({mode:'open'}).innerHTML = `<style>
        :host{display:inline-block;width:var(--bull-size,140px);aspect-ratio:1;flex-shrink:0}
        .frame{width:100%;height:100%;background-size:400% 400%;background-repeat:no-repeat;background-position:0 0}
      </style><div class="frame" aria-hidden="true"></div>`;
      this.frame = this.shadowRoot.querySelector('.frame');
      this.motion = matchMedia('(prefers-reduced-motion: reduce)');
      this.restart = () => this.play(this.getAttribute('state') || 'idle');
      this.visibility = () => document.hidden ? clearTimeout(this.timer) : this.restart();
    }
    connectedCallback() {
      this.updateSource();
      if (!this.hasAttribute('aria-label')) this.setAttribute('aria-hidden','true');
      else this.setAttribute('role','img');
      this.motion.addEventListener('change',this.restart);
      document.addEventListener('visibilitychange',this.visibility);
      this.restart();
    }
    disconnectedCallback() {
      clearTimeout(this.timer);
      this.motion.removeEventListener('change',this.restart);
      document.removeEventListener('visibilitychange',this.visibility);
    }
    attributeChangedCallback(name) {
      if (!this.isConnected) return;
      if (name === 'src') this.updateSource();
      else this.restart();
    }
    updateSource() {
      this.frame.style.backgroundImage = `url(${JSON.stringify(this.getAttribute('src') || defaultSheet)})`;
    }
    show(row,col) {
      this.frame.style.backgroundPosition = `${col*100/3}% ${row*100/3}%`;
    }
    play(state='idle') {
      clearTimeout(this.timer);
      if (!sequences[state]) state='idle';
      if (this.motion.matches || document.hidden) { this.show(0,0); return; }
      let i=0;
      const frames=sequences[state];
      const tick=()=>{
        if (!this.isConnected) return;
        const [row,col,ms]=frames[i]; this.show(row,col);
        this.timer=setTimeout(()=>{
          i++;
          if (i === frames.length) {
            if (state==='idle' || state==='read') i=0;
            else {
              this.dispatchEvent(new CustomEvent('mascot-finished',{detail:{state}}));
              this.play('idle'); return;
            }
          }
          tick();
        },ms);
      };
      tick();
    }
  }
  if (!customElements.get('bull-mascot')) customElements.define('bull-mascot',BullMascot);
})();
