import React, { useState, Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Environment, PerspectiveCamera, Float, Html } from '@react-three/drei';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Box, 
  Palette, 
  Settings2, 
  Layers, 
  Download, 
  Plus,
  Trash2,
  Info
} from 'lucide-react';
import { cn } from './lib/utils';

// --- Types ---

type FurnitureType = 'table' | 'sink' | 'wardrobe' | 'cabinet';
type MaterialType = 'wood' | 'metal' | 'plastic' | 'marble';

interface FurnitureConfig {
  id: string;
  type: FurnitureType;
  width: number;
  height: number;
  depth: number;
  thickness: number;
  legThickness: number;
  material: MaterialType;
  color: string;
  doorCount: number;
}

// --- Components ---

const Table = ({ config }: { config: FurnitureConfig }) => {
  const { width, height, depth, thickness, legThickness, color } = config;
  return (
    <group position={[0, -height / 2, 0]}>
      <mesh position={[0, height, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, thickness, depth]} />
        <meshStandardMaterial color={color} roughness={0.3} />
      </mesh>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z], i) => (
        <mesh key={i} position={[(width / 2 - legThickness / 2) * x, height / 2, (depth / 2 - legThickness / 2) * z]} castShadow receiveShadow>
          <boxGeometry args={[legThickness, height, legThickness]} />
          <meshStandardMaterial color={color} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
};

const Sink = ({ config }: { config: FurnitureConfig }) => {
  const { width, height, depth, color } = config;
  return (
    <group position={[0, -height / 2, 0]}>
      <mesh position={[0, height * 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height * 0.9, depth * 0.95]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, height * 0.95, 0]} castShadow receiveShadow>
        <boxGeometry args={[width * 1.02, height * 0.1, depth * 1.02]} />
        <meshStandardMaterial color="#ffffff" roughness={0.1} metalness={0.2} />
      </mesh>
      <mesh position={[0, height * 0.96, 0]} castShadow>
        <boxGeometry args={[width * 0.4, 0.05, depth * 0.6]} />
        <meshStandardMaterial color="#cccccc" metalness={0.8} roughness={0.2} />
      </mesh>
      <group position={[0, height, -depth * 0.3]}>
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.2]} />
          <meshStandardMaterial color="#eeeeee" metalness={1} roughness={0.1} />
        </mesh>
        <mesh position={[0, 0.2, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.1]} />
          <meshStandardMaterial color="#eeeeee" metalness={1} roughness={0.1} />
        </mesh>
      </group>
    </group>
  );
};

const Wardrobe = ({ config }: { config: FurnitureConfig }) => {
  const { width, height, depth, color, doorCount } = config;
  return (
    <group position={[0, -height / 2, 0]}>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      {Array.from({ length: doorCount - 1 }).map((_, i) => (
        <mesh key={i} position={[(-width / 2) + (width / doorCount) * (i + 1), height / 2, depth / 2 + 0.01]}>
          <boxGeometry args={[0.005, height * 0.98, 0.01]} />
          <meshStandardMaterial color="#000000" transparent opacity={0.3} />
        </mesh>
      ))}
      {Array.from({ length: doorCount }).map((_, i) => (
        <mesh key={i} position={[(-width / 2) + (width / doorCount) * (i + 0.5) + (i % 2 === 0 ? 0.05 : -0.05), height * 0.5, depth / 2 + 0.02]}>
          <boxGeometry args={[0.01, 0.15, 0.02]} />
          <meshStandardMaterial color="#333333" metalness={0.8} />
        </mesh>
      ))}
    </group>
  );
};

const Cabinet = ({ config }: { config: FurnitureConfig }) => {
  const { width, height, depth, color } = config;
  return (
    <group position={[0, -height / 2, 0]}>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
      {[0.25, 0.5, 0.75].map((h, i) => (
        <mesh key={i} position={[0, height * h, depth / 2 + 0.01]}>
          <boxGeometry args={[width * 0.95, 0.005, 0.01]} />
          <meshStandardMaterial color="#000000" transparent opacity={0.2} />
        </mesh>
      ))}
      {[0.125, 0.375, 0.625, 0.875].map((h, i) => (
        <mesh key={i} position={[0, height * h, depth / 2 + 0.02]}>
          <boxGeometry args={[width * 0.2, 0.01, 0.02]} />
          <meshStandardMaterial color="#555555" metalness={0.5} />
        </mesh>
      ))}
    </group>
  );
};

const FurnitureModule = ({ 
  config, 
  isSelected, 
  onSelect,
  onDelete
}: { 
  config: FurnitureConfig; 
  isSelected: boolean; 
  onSelect: () => void;
  onDelete: () => void;
}) => {
  return (
    <group>
      {/* Invisible hit box for easier clicking */}
      <mesh 
        position={[0, config.height / 2, 0]} 
        onClick={(e) => { 
          e.stopPropagation(); 
          onSelect(); 
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'auto'; }}
      >
        <boxGeometry args={[config.width, config.height, config.depth]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      <group>
        {config.type === 'table' && <Table config={config} />}
        {config.type === 'sink' && <Sink config={config} />}
        {config.type === 'wardrobe' && <Wardrobe config={config} />}
        {config.type === 'cabinet' && <Cabinet config={config} />}
      </group>
      
      {isSelected && (
        <mesh position={[0, config.height / 2, 0]}>
          <boxGeometry args={[config.width + 0.02, config.height + 0.02, config.depth + 0.02]} />
          <meshBasicMaterial color="#f97316" wireframe transparent opacity={0.5} />
        </mesh>
      )}
    </group>
  );
};

const DimensionPopup = ({ 
  config, 
  onUpdate,
  onClose
}: { 
  config: FurnitureConfig; 
  onUpdate: (updates: Partial<FurnitureConfig>) => void;
  onClose: () => void;
}) => {
  return (
    <div className="bg-white/95 backdrop-blur shadow-2xl rounded-2xl p-4 border border-orange-500/20 w-48 space-y-3 pointer-events-auto animate-in fade-in zoom-in duration-200">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Settings2 className="w-3 h-3 text-orange-500" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-black/60">Dimensions</span>
        </div>
      </div>
      {['width', 'height', 'depth'].map((dim) => (
        <div key={dim} className="space-y-1">
          <div className="flex justify-between text-[9px] font-bold text-black/40 uppercase">
            <span>{dim}</span>
            <span>{(config as any)[dim].toFixed(2)}m</span>
          </div>
          <input 
            type="range" min="0.3" max="4" step="0.01" 
            value={(config as any)[dim]} 
            onChange={(e) => onUpdate({ [dim]: parseFloat(e.target.value) })}
            className="w-full h-1 bg-black/5 rounded-lg appearance-none cursor-pointer accent-orange-500"
          />
        </div>
      ))}
      <button 
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="w-full py-2 mt-2 bg-orange-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-xl hover:bg-orange-600 transition-colors shadow-lg shadow-orange-500/20"
      >
        Confirm
      </button>
    </div>
  );
};

const ControlPanel = ({ 
  configs,
  selectedIndex,
  setConfigs,
  setSelectedIndex
}: { 
  configs: FurnitureConfig[];
  selectedIndex: number;
  setConfigs: React.Dispatch<React.SetStateAction<FurnitureConfig[]>>;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
}) => {
  const [activeTab, setActiveTab] = useState<'type' | 'dimensions' | 'materials'>('type');
  const config = configs[selectedIndex];

  const updateConfig = (updates: Partial<FurnitureConfig>) => {
    setConfigs(prev => {
      const newConfigs = [...prev];
      newConfigs[selectedIndex] = { ...newConfigs[selectedIndex], ...updates };
      return newConfigs;
    });
  };

  const removeModule = () => {
    if (configs.length <= 1) return;
    const newConfigs = configs.filter((_, i) => i !== selectedIndex);
    setConfigs(newConfigs);
    setSelectedIndex(Math.max(0, selectedIndex - 1));
  };

  const furnitureTypes: { id: FurnitureType; label: string; icon: any }[] = [
    { id: 'table', label: 'Table', icon: Box },
    { id: 'sink', label: 'Sink', icon: Layers },
    { id: 'wardrobe', label: 'Wardrobe', icon: Box },
    { id: 'cabinet', label: 'Cabinet', icon: Settings2 },
  ];

  const materials: { id: MaterialType; label: string; color: string }[] = [
    { id: 'wood', label: 'Oak Wood', color: '#8B4513' },
    { id: 'metal', label: 'Brushed Steel', color: '#708090' },
    { id: 'plastic', label: 'Matte Plastic', color: '#2F4F4F' },
    { id: 'marble', label: 'White Marble', color: '#F5F5F5' },
  ];

  return (
    <div className="absolute left-6 top-6 bottom-6 w-80 bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 flex flex-col overflow-hidden z-10">
      <div className="p-6 border-b border-black/5">
        <h1 className="text-2xl font-bold tracking-tight text-black flex items-center gap-2">
          <Box className="w-6 h-6 text-orange-500" />
          Studio 3D
        </h1>
        <div className="flex items-center justify-between mt-1">
          <p className="text-[10px] text-black/40 uppercase tracking-widest font-semibold">Module {selectedIndex + 1} of {configs.length}</p>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => {
                const newModule: FurnitureConfig = {
                  ...configs[configs.length - 1],
                  id: Math.random().toString(36).substr(2, 9),
                };
                setConfigs(prev => [...prev, newModule]);
                setSelectedIndex(configs.length);
              }}
              className="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center hover:bg-orange-600 transition-colors shadow-lg shadow-orange-500/20"
              title="Add Module"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            {configs.length > 1 && (
              <button onClick={removeModule} className="text-red-500 hover:text-red-600 transition-colors">
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex px-6 gap-4 border-b border-black/5">
        {['type', 'dimensions', 'materials'].map((tab) => (
          <button 
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className={cn(
              "pb-3 text-sm font-medium transition-all relative capitalize",
              activeTab === tab ? "text-orange-500" : "text-black/40 hover:text-black/60"
            )}
          >
            {tab}
            {activeTab === tab && <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {activeTab === 'type' && (
          <div className="grid grid-cols-2 gap-3">
            {furnitureTypes.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  const updates: Partial<FurnitureConfig> = { type: t.id };
                  if (t.id === 'wardrobe') { updates.height = 2.2; updates.width = 1.2; updates.depth = 0.6; }
                  else if (t.id === 'sink') { updates.height = 0.85; updates.width = 1.0; updates.depth = 0.6; }
                  else if (t.id === 'cabinet') { updates.height = 1.0; updates.width = 0.8; updates.depth = 0.4; }
                  else if (t.id === 'table') { updates.height = 0.75; updates.width = 1.6; updates.depth = 0.8; }
                  updateConfig(updates);
                }}
                className={cn(
                  "p-4 rounded-2xl border-2 transition-all text-center space-y-2",
                  config.type === t.id ? "border-orange-500 bg-orange-50" : "border-black/5 bg-black/5 hover:bg-black/10"
                )}
              >
                <t.icon className={cn("w-6 h-6 mx-auto", config.type === t.id ? "text-orange-500" : "text-black/40")} />
                <span className="text-[10px] font-bold block">{t.label}</span>
              </button>
            ))}
          </div>
        )}

        {activeTab === 'dimensions' && (
          <div className="space-y-6">
            {['width', 'height', 'depth'].map((dim) => (
              <div key={dim} className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-bold uppercase text-black/40 tracking-wider">{dim}</label>
                  <span className="text-[10px] font-mono bg-black/5 px-2 py-0.5 rounded text-black/60">{(config as any)[dim].toFixed(1)}m</span>
                </div>
                <input 
                  type="range" min="0.3" max="4" step="0.1" 
                  value={(config as any)[dim]} 
                  onChange={(e) => updateConfig({ [dim]: parseFloat(e.target.value) })}
                  className="w-full accent-orange-500"
                />
              </div>
            ))}
            {config.type === 'wardrobe' && (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-bold uppercase text-black/40 tracking-wider">Doors</label>
                  <span className="text-[10px] font-mono bg-black/5 px-2 py-0.5 rounded text-black/60">{config.doorCount}</span>
                </div>
                <input 
                  type="range" min="1" max="6" step="1" 
                  value={config.doorCount} 
                  onChange={(e) => updateConfig({ doorCount: parseInt(e.target.value) })}
                  className="w-full accent-orange-500"
                />
              </div>
            )}
          </div>
        )}

        {activeTab === 'materials' && (
          <div className="grid grid-cols-2 gap-3">
            {materials.map((m) => (
              <button
                key={m.id}
                onClick={() => updateConfig({ material: m.id, color: m.color })}
                className={cn(
                  "p-4 rounded-2xl border-2 transition-all text-left space-y-2",
                  config.material === m.id ? "border-orange-500 bg-orange-50" : "border-black/5 bg-black/5 hover:bg-black/10"
                )}
              >
                <div className="w-8 h-8 rounded-full shadow-inner" style={{ backgroundColor: m.color }} />
                <span className="text-[10px] font-bold block">{m.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="p-6 space-y-3 bg-black/5">
        <button className="w-full py-3 bg-black text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-black/80 transition-colors">
          <Download className="w-4 h-4" />
          Export Project
        </button>
      </div>
    </div>
  );
};

export default function App() {
  const [configs, setConfigs] = useState<FurnitureConfig[]>([
    {
      id: Math.random().toString(36).substr(2, 9),
      type: 'table',
      width: 1.6,
      height: 0.75,
      depth: 0.8,
      thickness: 0.04,
      legThickness: 0.06,
      material: 'wood',
      color: '#8B4513',
      doorCount: 2
    }
  ]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPopupOpen, setIsPopupOpen] = useState(false);

  const totalWidth = useMemo(() => configs.reduce((acc, c) => acc + c.width, 0), [configs]);

  const updateConfig = (index: number, updates: Partial<FurnitureConfig>) => {
    setConfigs(prev => {
      const newConfigs = [...prev];
      newConfigs[index] = { ...newConfigs[index], ...updates };
      return newConfigs;
    });
  };

  const removeModule = (index: number) => {
    if (configs.length <= 1) return;
    setConfigs(prev => prev.filter((_, i) => i !== index));
    setSelectedIndex(prev => Math.max(0, prev >= index ? prev - 1 : prev));
    setIsPopupOpen(false);
  };

  const addModule = (index: number, direction: 'left' | 'right') => {
    const newModule: FurnitureConfig = {
      ...configs[index],
      id: Math.random().toString(36).substr(2, 9),
    };
    const newConfigs = [...configs];
    const insertIndex = direction === 'left' ? index : index + 1;
    newConfigs.splice(insertIndex, 0, newModule);
    setConfigs(newConfigs);
    setSelectedIndex(insertIndex);
    setIsPopupOpen(true);
  };

  return (
    <div className="w-full h-screen bg-[#f0f0f0] overflow-hidden relative font-sans">
      <div className="absolute inset-0">
        <Canvas shadows gl={{ antialias: true }}>
          <PerspectiveCamera makeDefault position={[4, 4, 4]} fov={50} />
          <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2} enableDamping />
          
          <Suspense fallback={null}>
            <Environment preset="city" />
            <ambientLight intensity={0.5} />
            <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1} castShadow />
            
            <group position={[-totalWidth / 2, 0, 0]}>
              {configs.map((config, i) => {
                const prevWidth = configs.slice(0, i).reduce((acc, c) => acc + c.width, 0);
                const xPos = prevWidth + config.width / 2;
                
                return (
                  <group key={config.id} position={[xPos, 0, 0]}>
                    <FurnitureModule 
                      config={config} 
                      isSelected={selectedIndex === i} 
                      onSelect={() => {
                        setSelectedIndex(i);
                        setIsPopupOpen(true);
                      }} 
                      onDelete={() => removeModule(i)}
                    />
                    
                    {/* Side Add Buttons - Only if no neighbor */}
                    {selectedIndex === i && (
                      <>
                        {i === 0 && (
                          <Html position={[-config.width / 2 - 0.1, config.height / 2, 0]} center pointerEvents="none">
                            <button 
                              onClick={(e) => { e.stopPropagation(); addModule(i, 'left'); }}
                              className="w-8 h-8 bg-white/90 backdrop-blur shadow-lg rounded-full flex items-center justify-center text-orange-500 hover:bg-orange-500 hover:text-white transition-all transform hover:scale-110 pointer-events-auto"
                              title="Add Left"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </Html>
                        )}
                        
                        {i === configs.length - 1 && (
                          <Html position={[config.width / 2 + 0.1, config.height / 2, 0]} center pointerEvents="none">
                            <button 
                              onClick={(e) => { e.stopPropagation(); addModule(i, 'right'); }}
                              className="w-8 h-8 bg-white/90 backdrop-blur shadow-lg rounded-full flex items-center justify-center text-orange-500 hover:bg-orange-500 hover:text-white transition-all transform hover:scale-110 pointer-events-auto"
                              title="Add Right"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </Html>
                        )}

                        {/* Dimension Popup */}
                        {isPopupOpen && (
                          <Html position={[0, config.height + 0.4, 0]} center pointerEvents="none">
                            <DimensionPopup 
                              config={config} 
                              onUpdate={(updates) => updateConfig(i, updates)} 
                              onClose={() => setIsPopupOpen(false)}
                            />
                          </Html>
                        )}
                      </>
                    )}
                  </group>
                );
              })}
            </group>

            <ContactShadows position={[0, -0.5, 0]} opacity={0.4} scale={20} blur={2.5} far={4} />
            <gridHelper args={[40, 40, 0x000000, 0xcccccc]} position={[0, -0.5, 0]} />
          </Suspense>
        </Canvas>
      </div>

      <ControlPanel 
        configs={configs} 
        selectedIndex={selectedIndex} 
        setConfigs={setConfigs} 
        setSelectedIndex={setSelectedIndex} 
      />

      <div className="absolute right-6 top-6 flex flex-col gap-4">
        <div className="bg-white/80 backdrop-blur-md p-4 rounded-2xl shadow-lg border border-white/20 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center">
            <Info className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-black/40 tracking-wider">Total Modules</p>
            <p className="text-sm font-bold text-black">{configs.length} Units</p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-6 right-6 text-right">
        <p className="text-[10px] font-bold uppercase text-black/20 tracking-[0.2em]">Studio 3D Modular Designer</p>
      </div>
    </div>
  );
}
