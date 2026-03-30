"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[508],{2508:function(e,t,i){i.r(t),i.d(t,{default:function(){return b}});var a=i(7437),r=i(2265),s=i(6496),o=i(1119),n=i(2079),l=i(9285);let d=parseInt(n.UZH.replace(/\D+/g,"")),c=function(e,t,i,a){let r=class extends n.jyz{constructor(a={}){let r=Object.entries(e);super({uniforms:r.reduce((e,[t,i])=>{let a=n.rDY.clone({[t]:{value:i}});return{...e,...a}},{}),vertexShader:t,fragmentShader:i}),this.key="",r.forEach(([e])=>Object.defineProperty(this,e,{get:()=>this.uniforms[e].value,set:t=>this.uniforms[e].value=t})),Object.assign(this,a)}};return r.key=n.M8C.generateUUID(),r}({cellSize:.5,sectionSize:1,fadeDistance:100,fadeStrength:1,fadeFrom:1,cellThickness:.5,sectionThickness:1,cellColor:new n.Ilk,sectionColor:new n.Ilk,infiniteGrid:!1,followCamera:!1,worldCamProjPosition:new n.Pa4,worldPlanePosition:new n.Pa4},`
    varying vec3 localPosition;
    varying vec4 worldPosition;

    uniform vec3 worldCamProjPosition;
    uniform vec3 worldPlanePosition;
    uniform float fadeDistance;
    uniform bool infiniteGrid;
    uniform bool followCamera;

    void main() {
      localPosition = position.xzy;
      if (infiniteGrid) localPosition *= 1.0 + fadeDistance;
      
      worldPosition = modelMatrix * vec4(localPosition, 1.0);
      if (followCamera) {
        worldPosition.xyz += (worldCamProjPosition - worldPlanePosition);
        localPosition = (inverse(modelMatrix) * worldPosition).xyz;
      }

      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,`
    varying vec3 localPosition;
    varying vec4 worldPosition;

    uniform vec3 worldCamProjPosition;
    uniform float cellSize;
    uniform float sectionSize;
    uniform vec3 cellColor;
    uniform vec3 sectionColor;
    uniform float fadeDistance;
    uniform float fadeStrength;
    uniform float fadeFrom;
    uniform float cellThickness;
    uniform float sectionThickness;

    float getGrid(float size, float thickness) {
      vec2 r = localPosition.xz / size;
      vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
      float line = min(grid.x, grid.y) + 1.0 - thickness;
      return 1.0 - min(line, 1.0);
    }

    void main() {
      float g1 = getGrid(cellSize, cellThickness);
      float g2 = getGrid(sectionSize, sectionThickness);

      vec3 from = worldCamProjPosition*vec3(fadeFrom);
      float dist = distance(from, worldPosition.xyz);
      float d = 1.0 - min(dist / fadeDistance, 1.0);
      vec3 color = mix(cellColor, sectionColor, min(1.0, sectionThickness * g2));

      gl_FragColor = vec4(color, (g1 + g2) * pow(d, fadeStrength));
      gl_FragColor.a = mix(0.75 * gl_FragColor.a, gl_FragColor.a, g2);
      if (gl_FragColor.a <= 0.0) discard;

      #include <tonemapping_fragment>
      #include <${d>=154?"colorspace_fragment":"encodings_fragment"}>
    }
  `),m=r.forwardRef(({args:e,cellColor:t="#000000",sectionColor:i="#2080ff",cellSize:a=.5,sectionSize:s=1,followCamera:d=!1,infiniteGrid:m=!1,fadeDistance:p=100,fadeStrength:x=1,fadeFrom:f=1,cellThickness:u=.5,sectionThickness:g=1,side:h=n._Li,...b},w)=>{(0,l.e)({GridMaterial:c});let j=r.useRef(null);r.useImperativeHandle(w,()=>j.current,[]);let v=new n.JOQ,y=new n.Pa4(0,1,0),N=new n.Pa4(0,0,0);return(0,l.F)(e=>{v.setFromNormalAndCoplanarPoint(y,N).applyMatrix4(j.current.matrixWorld);let t=j.current.material,i=t.uniforms.worldCamProjPosition,a=t.uniforms.worldPlanePosition;v.projectPoint(e.camera.position,i.value),a.value.set(0,0,0).applyMatrix4(j.current.matrixWorld)}),r.createElement("mesh",(0,o.Z)({ref:j,frustumCulled:!1},b),r.createElement("gridMaterial",(0,o.Z)({transparent:!0,"extensions-derivatives":!0,side:h},{cellSize:a,sectionSize:s,cellColor:t,sectionColor:i,cellThickness:u,sectionThickness:g},{fadeDistance:p,fadeStrength:x,fadeFrom:f,infiniteGrid:m,followCamera:d})),r.createElement("planeGeometry",{args:e}))});var p=i(5903),x=i(7922),f=i(4725),u=i(2539);function g(e){let{parts:t,palette:i,cameraView:r}=e;return(0,a.jsxs)(a.Fragment,{children:[(0,a.jsx)("color",{attach:"background",args:["#f4efe7"]}),(0,a.jsx)("ambientLight",{intensity:1.6}),(0,a.jsx)("directionalLight",{position:[1800,2200,1200],intensity:2.1,castShadow:!0}),(0,a.jsx)("directionalLight",{position:[-1200,1e3,-900],intensity:.8}),(0,a.jsx)("group",{rotation:"top"===r?[-Math.PI/2,0,0]:[0,0,0],children:t.map(e=>(0,a.jsxs)("mesh",{position:[e.x,e.y,e.z],castShadow:!0,receiveShadow:!0,children:[(0,a.jsx)("boxGeometry",{args:[e.width,e.height,e.depth]}),(0,a.jsx)("meshStandardMaterial",{color:i[e.colorKey],metalness:e.wireframe?.1:.2,roughness:e.wireframe?.5:.75,wireframe:e.wireframe})]},e.id))}),(0,a.jsxs)("mesh",{rotation:[-Math.PI/2,0,0],receiveShadow:!0,position:[0,-.5,0],children:[(0,a.jsx)("planeGeometry",{args:[1e4,1e4]}),(0,a.jsx)("shadowMaterial",{opacity:.16,polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:1})]}),(0,a.jsx)(m,{args:[1e4,1e4],position:[0,.5,0],cellSize:100,cellThickness:.8,sectionSize:500,sectionThickness:1.2,cellColor:"#d5cab8",sectionColor:"#bcae98",fadeDistance:8e3,fadeStrength:1,infiniteGrid:!0}),(0,a.jsx)(p.z,{enablePan:!0,minDistance:700,maxDistance:7e3,target:[0,900,0],minPolarAngle:"top"===r?.01:.25,maxPolarAngle:"top"===r?.01:Math.PI/2}),(0,a.jsx)(x.qA,{preset:"apartment"}),(0,a.jsx)("primitive",{object:new n.y8_(900),position:[-2600,20,-2600]}),(0,a.jsx)(f.c,{makeDefault:!0,position:"top"===r?[0,2400,.01]:"front"===r?[0,900,2800]:[2300,1500,2300],fov:38,near:1,far:2e4})]})}let h=[{key:"footprintAreaM2",label:"설치 면적"},{key:"facadeAreaM2",label:"정면 면적"},{key:"estimatedBoardAreaM2",label:"보드 면적"}];function b(e){let[t,i]=(0,r.useState)(()=>{let t=(0,u.xS)(e.initialPreset||"sink");return e.initialWidth&&(t.width=e.initialWidth),e.initialHeight&&(t.height=e.initialHeight),e.initialDepth&&(t.depth=e.initialDepth),e.initialMaterial&&(t.material=e.initialMaterial),e.initialLowerCount&&(t.lowerCount=e.initialLowerCount),e.initialUpperCount&&(t.upperCount=e.initialUpperCount),t}),[o,n]=(0,r.useState)("perspective"),[l,d]=(0,r.useState)(""),c=(0,r.useMemo)(()=>(0,u.Rv)(t),[t]),m=u.gU[t.material],p=c.preset;(0,r.useEffect)(()=>{let e=e=>{var t;(null===(t=e.data)||void 0===t?void 0:t.type)==="UPDATE_PLANNER"&&i(t=>({...t,...e.data.payload}))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[]),(0,r.useEffect)(()=>{var e;null===(e=window.parent)||void 0===e||e.postMessage({type:"PLANNER_STATE",payload:{planner:t,derived:c}},"*")},[t,c]),(0,r.useEffect)(()=>{if(!l)return;let e=window.setTimeout(()=>d(""),2200);return()=>window.clearTimeout(e)},[l]);let x=(e,t)=>{i(i=>({...i,[e]:t}))},f=async()=>{let e=new Blob([JSON.stringify({generatedAt:new Date().toISOString(),planner:t,preset:(0,u.qr)(t.presetId),derived:c},null,2)],{type:"application/json"}),i=URL.createObjectURL(e),a=document.createElement("a");a.href=i,a.download="dadam-".concat(t.presetId,"-plan.json"),a.click(),URL.revokeObjectURL(i),d("JSON 저장 완료")};return(0,a.jsx)("div",{className:"min-h-screen bg-[radial-gradient(circle_at_top,#f5ede0_0%,#f8f7f4_45%,#ece4d8_100%)] text-dadam-charcoal",children:(0,a.jsxs)("div",{className:"mx-auto flex max-w-[1800px] flex-col gap-4 px-4 py-4 lg:px-6 lg:py-6",children:[(0,a.jsxs)("div",{className:"flex flex-col gap-3 rounded-[26px] border border-[#d9ccb8] bg-[#fffaf2]/90 p-4 shadow-[0_18px_60px_rgba(88,67,42,0.08)] lg:flex-row lg:items-center lg:justify-between",children:[(0,a.jsxs)("div",{children:[(0,a.jsx)("p",{className:"text-xs uppercase tracking-[0.3em] text-[#9b7b55]",children:"Detail Design Style"}),(0,a.jsxs)("h1",{className:"mt-2 font-serif text-3xl",children:[p.name," — 3D 도면"]})]}),(0,a.jsxs)("div",{className:"flex flex-wrap items-center gap-3",children:[(0,a.jsxs)("span",{className:"rounded-xl bg-[#f7f1e8] px-3 py-2 text-sm",children:["W ",(0,u.ET)(t.width)," / H ",(0,u.ET)(t.height)," / D ",(0,u.ET)(t.depth)]}),(0,a.jsx)("button",{type:"button",onClick:f,className:"rounded-full border border-[#d6c9b3] bg-white px-4 py-2 text-sm font-medium",children:"JSON 저장"}),(0,a.jsx)("button",{type:"button",className:"rounded-full bg-[#2d2a26] px-4 py-2 text-sm font-semibold text-white",children:"제출 준비"})]})]}),(0,a.jsxs)("div",{className:"grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(540px,1fr)_auto]",children:[(0,a.jsxs)("main",{className:"relative overflow-hidden rounded-[28px] border border-[#d9ccb8] bg-[#efe5d7] shadow-[0_24px_80px_rgba(55,39,18,0.08)]",children:[(0,a.jsx)("div",{className:"absolute right-4 top-4 z-10 flex gap-2",children:["perspective","front","top"].map(e=>(0,a.jsx)("button",{type:"button",onClick:()=>n(e),className:"rounded-full px-3 py-2 text-xs font-semibold ".concat(o===e?"bg-[#2d2a26] text-white":"bg-white/85 text-dadam-charcoal"),children:"perspective"===e?"원근":"front"===e?"정면":"평면"},e))}),(0,a.jsx)(s.Xz,{shadows:!0,dpr:[1,1.5],children:(0,a.jsx)(g,{parts:c.parts,palette:m,cameraView:o})})]}),(0,a.jsxs)("aside",{className:"rounded-[24px] border border-[#d9ccb8] bg-white p-4 shadow-[0_16px_40px_rgba(88,67,42,0.07)]",children:[(0,a.jsx)("p",{className:"text-xs uppercase tracking-[0.24em] text-[#9b7f5c]",children:"옵션"}),(0,a.jsx)("h2",{className:"mt-2 text-xl font-semibold",children:p.name}),(0,a.jsxs)("div",{className:"mt-4 grid gap-4",children:[(0,a.jsxs)("label",{className:"grid gap-2 text-sm",children:[(0,a.jsx)("span",{children:"하부 모듈 수"}),(0,a.jsx)("input",{type:"number",min:1,max:10,value:t.lowerCount,onChange:e=>x("lowerCount",Number(e.target.value)),className:"rounded-xl border border-[#d7c8b3] px-3 py-2"})]}),(0,a.jsxs)("label",{className:"grid gap-2 text-sm",children:[(0,a.jsx)("span",{children:"상부 모듈 수"}),(0,a.jsx)("input",{type:"number",min:0,max:10,value:t.upperCount,onChange:e=>x("upperCount",Number(e.target.value)),className:"rounded-xl border border-[#d7c8b3] px-3 py-2",disabled:p.fullHeight})]}),(0,a.jsxs)("div",{className:"grid gap-2",children:[(0,a.jsx)("span",{className:"text-sm",children:"재질 톤"}),Object.entries(u.gU).map(e=>{let[r,s]=e;return(0,a.jsxs)("button",{type:"button",onClick:()=>i(e=>({...e,material:r})),className:"flex items-center justify-between rounded-2xl border px-3 py-3 text-left ".concat(t.material===r?"border-[#8d6b45] bg-[#f8efe2]":"border-[#ddd0bd]"),children:[(0,a.jsx)("span",{className:"text-sm font-medium",children:s.name}),(0,a.jsxs)("span",{className:"flex gap-1",children:[(0,a.jsx)("span",{className:"h-4 w-4 rounded-full border",style:{backgroundColor:s.body}}),(0,a.jsx)("span",{className:"h-4 w-4 rounded-full border",style:{backgroundColor:s.accent}})]})]},r)})]})]})]}),(0,a.jsx)("section",{className:"rounded-[24px] border border-[#d9ccb8] bg-white p-4 shadow-[0_16px_40px_rgba(88,67,42,0.07)] lg:col-span-2",children:(0,a.jsxs)("div",{className:"grid gap-4 xl:grid-cols-[1.1fr_1fr]",children:[(0,a.jsxs)("div",{children:[(0,a.jsx)("p",{className:"text-xs uppercase tracking-[0.24em] text-[#9b7f5c]",children:"하단 요약"}),(0,a.jsx)("div",{className:"mt-3 grid gap-3 sm:grid-cols-3",children:h.map(e=>(0,a.jsxs)("div",{className:"rounded-2xl bg-[#f7f1e8] px-4 py-3",children:[(0,a.jsx)("p",{className:"text-xs text-dadam-gray",children:e.label}),(0,a.jsxs)("p",{className:"mt-1 text-xl font-semibold",children:[c[e.key].toLocaleString("ko-KR")," m\xb2"]})]},e.key))})]}),(0,a.jsxs)("div",{children:[(0,a.jsx)("p",{className:"text-xs uppercase tracking-[0.24em] text-[#9b7f5c]",children:"모듈 리스트"}),(0,a.jsx)("div",{className:"mt-3 grid max-h-[180px] gap-2 overflow-y-auto",children:c.modules.map(e=>(0,a.jsxs)("div",{className:"grid grid-cols-[1fr_auto_auto] rounded-xl bg-[#f7f1e8] px-3 py-2 text-sm",children:[(0,a.jsx)("span",{className:"font-medium",children:e.id.toUpperCase()}),(0,a.jsx)("span",{children:(0,u.ET)(e.width)}),(0,a.jsx)("span",{className:"text-dadam-gray",children:e.section})]},e.id))}),l?(0,a.jsx)("p",{className:"mt-3 text-sm text-[#7a5c33]",children:l}):null]})]})})]})]})})}}}]);