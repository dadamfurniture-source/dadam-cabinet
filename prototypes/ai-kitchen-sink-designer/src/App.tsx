/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Upload, Image as ImageIcon, Loader2, Sparkles, RefreshCw, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type DesignOption = 'basic' | 'ai_recommend_1' | 'ai_recommend_2';

interface DesignResult {
  url: string;
  option: DesignOption;
}

export default function App() {
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<DesignResult[]>([]);
  const [selectedOption, setSelectedOption] = useState<DesignOption>('basic');
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSourceImage(reader.result as string);
        setResults([]);
        setError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const generateDesign = async () => {
    if (!sourceImage) return;

    setIsGenerating(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      let prompt = "";
      const commonDetails = "Use finger groove handles (J-pull handles) for all cabinets. Include a built-in induction cooktop on the countertop, and the cabinet directly under the cooktop should be a 2-tier drawer unit.";
      
      if (selectedOption === 'basic') {
        prompt = `Redesign this kitchen sink and cabinet area. Use random achromatic colors like white, gray, or black for all cabinets. Keep the layout similar but modernize the look with clean lines. ${commonDetails}`;
      } else if (selectedOption === 'ai_recommend_1') {
        prompt = `Redesign this kitchen sink and cabinet area. Make the upper cabinets an achromatic color (like white or light gray) and the lower cabinets a vibrant, non-achromatic color with a distinct texture (e.g., deep navy blue wood grain, emerald green matte, or terracotta ceramic). ${commonDetails}`;
      } else if (selectedOption === 'ai_recommend_2') {
        prompt = `Redesign this kitchen sink and cabinet area. Make the lower cabinets an achromatic color (like charcoal or dark gray) and the upper cabinets a warm, non-achromatic color with a unique texture (e.g., oak wood, sage green linen, or mustard yellow gloss). ${commonDetails}`;
      }

      const base64Data = sourceImage.split(',')[1];
      const mimeType = sourceImage.split(';')[0].split(':')[1];

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      });

      let generatedImageUrl = "";
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          generatedImageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }

      if (generatedImageUrl) {
        setResults(prev => [{ url: generatedImageUrl, option: selectedOption }, ...prev]);
      } else {
        throw new Error("No image was generated. Please try again.");
      }
    } catch (err: any) {
      console.error("Generation error:", err);
      setError(err.message || "Failed to generate design. Please check your connection and try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#1C1917] font-sans selection:bg-[#D6D3D1]">
      {/* Header */}
      <header className="border-b border-[#E7E5E4] bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#1C1917] rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">SinkAI Designer</h1>
          </div>
          <div className="text-sm text-[#78716C] font-medium">
            AI-Powered Kitchen Transformation
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid lg:grid-cols-12 gap-12">
          
          {/* Left Column: Controls */}
          <div className="lg:col-span-5 space-y-8">
            <section className="space-y-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-[#A8A29E]">Step 01</h2>
              <h3 className="text-2xl font-semibold">Upload Original Photo</h3>
              <div 
                onClick={() => fileInputRef.current?.click()}
                className={`
                  relative aspect-video rounded-2xl border-2 border-dashed transition-all cursor-pointer overflow-hidden
                  ${sourceImage ? 'border-transparent' : 'border-[#D6D3D1] hover:border-[#A8A29E] bg-white'}
                `}
              >
                {sourceImage ? (
                  <>
                    <img src={sourceImage} alt="Original" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                      <p className="text-white font-medium flex items-center gap-2">
                        <RefreshCw className="w-4 h-4" /> Change Photo
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#78716C]">
                    <Upload className="w-8 h-8" />
                    <p className="text-sm font-medium">Click to upload or drag and drop</p>
                    <p className="text-xs opacity-60">JPG, PNG up to 5MB</p>
                  </div>
                )}
              </div>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleImageUpload} 
                accept="image/*" 
                className="hidden" 
              />
            </section>

            <section className="space-y-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-[#A8A29E]">Step 02</h2>
              <h3 className="text-2xl font-semibold">Select Design Style</h3>
              <div className="grid gap-3">
                {[
                  { id: 'basic', label: 'Basic (Achromatic)', desc: 'Random mix of white, gray, and black.' },
                  { id: 'ai_recommend_1', label: 'AI Recommend A', desc: 'Achromatic upper, textured color lower.' },
                  { id: 'ai_recommend_2', label: 'AI Recommend B', desc: 'Achromatic lower, textured color upper.' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setSelectedOption(opt.id as DesignOption)}
                    className={`
                      w-full p-4 rounded-xl border-2 text-left transition-all
                      ${selectedOption === opt.id 
                        ? 'border-[#1C1917] bg-white shadow-sm' 
                        : 'border-transparent bg-[#E7E5E4]/50 hover:bg-[#E7E5E4]'}
                    `}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold">{opt.label}</span>
                      {selectedOption === opt.id && <CheckCircle2 className="w-4 h-4 text-[#1C1917]" />}
                    </div>
                    <p className="text-xs text-[#78716C] leading-relaxed">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </section>

            <button
              disabled={!sourceImage || isGenerating}
              onClick={generateDesign}
              className={`
                w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all
                ${!sourceImage || isGenerating 
                  ? 'bg-[#D6D3D1] text-[#A8A29E] cursor-not-allowed' 
                  : 'bg-[#1C1917] text-white hover:bg-black shadow-lg hover:shadow-xl active:scale-[0.98]'}
              `}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Generate New Sink
                </>
              )}
            </button>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">
                {error}
              </p>
            )}
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-3xl p-8 min-h-[600px] shadow-sm border border-[#E7E5E4]">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <ImageIcon className="w-5 h-5" />
                  Generated Designs
                </h2>
                <span className="text-xs font-mono bg-[#F5F5F4] px-2 py-1 rounded">
                  {results.length} results
                </span>
              </div>

              <div className="space-y-8">
                <AnimatePresence mode="popLayout">
                  {results.length > 0 ? (
                    results.map((res, idx) => (
                      <motion.div
                        key={res.url}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="group relative"
                      >
                        <div className="absolute top-4 left-4 z-10">
                          <span className="bg-white/90 backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-sm">
                            {res.option.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="overflow-hidden rounded-2xl bg-[#F5F5F4] aspect-video">
                          <img 
                            src={res.url} 
                            alt={`Result ${idx}`} 
                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div className="mt-4 flex items-center justify-between">
                          <p className="text-xs text-[#A8A29E] font-medium">Generated via Gemini 2.5 Flash Image</p>
                          <a 
                            href={res.url} 
                            download={`kitchen-design-${idx}.png`}
                            className="text-xs font-bold underline underline-offset-4 hover:text-black"
                          >
                            Download Image
                          </a>
                        </div>
                      </motion.div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-32 text-[#A8A29E] text-center">
                      <div className="w-16 h-16 bg-[#F5F5F4] rounded-full flex items-center justify-center mb-4">
                        <ImageIcon className="w-8 h-8 opacity-20" />
                      </div>
                      <p className="font-medium">No designs generated yet</p>
                      <p className="text-xs max-w-[200px] mt-2">Upload a photo and click generate to see AI recommendations</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-6 py-12 border-t border-[#E7E5E4] mt-12">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 opacity-50">
            <Sparkles className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-widest">SinkAI Designer</span>
          </div>
          <p className="text-xs text-[#A8A29E]">© 2026 AI Kitchen Studio. Powered by Google Gemini.</p>
        </div>
      </footer>
    </div>
  );
}
