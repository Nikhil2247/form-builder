'use client';

import React, { useState } from 'react';
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from '@/components/ui/accordion';
import { motion, AnimatePresence } from 'framer-motion';
import { MousePointer2, GitFork, BellRing, BarChart3, Palette } from 'lucide-react';

const showcaseItems = [
  {
    id: 'item-1',
    title: 'No-code, drag-and-drop builder',
    description: "Create forms effortlessly with our intuitive no-code builder. Whether you're a novice or an expert, simply drag and drop elements to build your perfect form in minutes. No coding knowledge required.",
    icon: MousePointer2,
    visual: (
      <div className="w-full h-full rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 p-6 relative overflow-hidden flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-amber-400" />
            <div className="w-3 h-3 rounded-full bg-emerald-400" />
          </div>
          <div className="flex-1 h-6 bg-white rounded-md border border-slate-200 ml-4" />
        </div>
        
        <div className="flex flex-1 gap-4">
          {/* Sidebar */}
          <div className="w-28 bg-white rounded-xl border border-slate-200 p-3 flex flex-col gap-3">
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Fields</div>
            {['Text', 'Email', 'Phone', 'Select'].map((label, i) => (
              <motion.div 
                key={i} 
                className="h-7 bg-slate-50 rounded-md border border-slate-200 flex items-center px-2 text-[10px] font-medium text-slate-600 cursor-pointer hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-colors"
                whileHover={{ scale: 1.02 }}
              >
                {label}
              </motion.div>
            ))}
          </div>
          
          {/* Canvas */}
          <div className="flex-1 bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-3">
            <div className="text-xs font-semibold text-slate-800">Contact Form</div>
            <div className="space-y-2.5">
              <div className="h-8 bg-slate-50 rounded-md border border-slate-200" />
              <div className="h-8 bg-slate-50 rounded-md border border-slate-200" />
              <motion.div 
                className="h-8 bg-indigo-50 rounded-md border-2 border-dashed border-indigo-300 flex items-center justify-center text-[10px] text-indigo-500 font-medium"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                Drop field here
              </motion.div>
            </div>
          </div>
        </div>
        
        {/* Animated cursor */}
        <motion.div 
          className="absolute z-20 text-indigo-600 drop-shadow-md"
          animate={{ 
            x: [60, 200, 200, 60], 
            y: [120, 120, 200, 200] 
          }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        >
          <MousePointer2 fill="currentColor" size={20} />
        </motion.div>
      </div>
    )
  },
  {
    id: 'item-2',
    title: 'Conditional logic & Workflows',
    description: "Build smart forms that react to user input. Show or hide fields, skip pages, and redirect respondents based on their answers to create personalized, high-converting experiences.",
    icon: GitFork,
    visual: (
      <div className="w-full h-full rounded-2xl bg-gradient-to-br from-violet-50 to-slate-50 border border-slate-200 p-6 flex items-center justify-center relative overflow-hidden">
        {/* Background dots */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.05)_1px,transparent_0)] bg-[size:20px_20px]" />
        
        <div className="flex flex-col items-center gap-3 relative z-10 w-full max-w-[280px]">
          {/* Question node */}
          <motion.div 
            className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm w-full text-center"
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5 }}
          >
            <div className="text-[10px] text-slate-400 uppercase font-semibold mb-1">Question</div>
            <div className="text-sm font-medium text-slate-700">What&apos;s your role?</div>
          </motion.div>
          
          {/* Branches */}
          <svg width="200" height="40" className="text-slate-300">
            <path d="M100,0 L40,40" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="4,4" />
            <path d="M100,0 L160,40" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="4,4" />
          </svg>
          
          <div className="flex justify-between w-full gap-3">
            <motion.div 
              className="flex-1 bg-indigo-50 border border-indigo-200 text-indigo-700 p-3 rounded-xl text-center shadow-sm"
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 3, repeat: Infinity, delay: 0 }}
            >
              <div className="text-[10px] font-semibold uppercase mb-1">Developer</div>
              <div className="text-[11px] text-indigo-500">→ API docs</div>
            </motion.div>
            <motion.div 
              className="flex-1 bg-emerald-50 border border-emerald-200 text-emerald-700 p-3 rounded-xl text-center shadow-sm"
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 3, repeat: Infinity, delay: 0.5 }}
            >
              <div className="text-[10px] font-semibold uppercase mb-1">Designer</div>
              <div className="text-[11px] text-emerald-500">→ Templates</div>
            </motion.div>
          </div>
        </div>
      </div>
    )
  },
  {
    id: 'item-3',
    title: 'Real-time notifications & alerts',
    description: "Stay in the loop instantly. Get email alerts, Slack messages, or trigger webhooks the second a user submits your form. Never miss a lead or support request again.",
    icon: BellRing,
    visual: (
      <div className="w-full h-full rounded-2xl bg-gradient-to-br from-amber-50 to-slate-50 border border-slate-200 p-6 relative overflow-hidden flex items-center justify-center">
        {/* Background rings */}
        <div className="absolute inset-0 flex items-center justify-center">
          {[140, 200, 260].map((size, i) => (
            <motion.div 
              key={i}
              className="absolute rounded-full border border-amber-200/50"
              style={{ width: size, height: size }}
              animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 3, repeat: Infinity, delay: i * 0.4 }}
            />
          ))}
        </div>
        
        {/* Central bell */}
        <div className="relative z-10 flex flex-col items-center gap-4">
          <motion.div 
            className="w-16 h-16 bg-white rounded-2xl border border-amber-200 shadow-lg flex items-center justify-center text-amber-500"
            animate={{ rotate: [0, -10, 10, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 2 }}
          >
            <BellRing size={28} />
          </motion.div>
          
          {/* Toast notifications */}
          {[
            { name: "jane@acme.co", text: "Submitted application", delay: 0 },
            { name: "mark@corp.io", text: "New feedback received", delay: 1.5 }
          ].map((notif, i) => (
            <motion.div 
              key={i}
              className="bg-white rounded-lg border border-slate-200 shadow-md px-4 py-2.5 flex items-center gap-3 w-64"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: [0, 1, 1, 0], x: [30, 0, 0, -10] }}
              transition={{ duration: 3, repeat: Infinity, delay: notif.delay, times: [0, 0.15, 0.85, 1] }}
            >
              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs font-bold shrink-0">
                {notif.name[0].toUpperCase()}
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-800">{notif.name}</div>
                <div className="text-[10px] text-slate-500">{notif.text}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    )
  },
  {
    id: 'item-4',
    title: 'Advanced analytics & insights',
    description: "Track form views, completion rates, drop-off points, and average submission time. Make data-driven decisions to optimize your forms and improve conversion rates.",
    icon: BarChart3,
    visual: (
      <div className="w-full h-full rounded-2xl bg-gradient-to-br from-blue-50 to-slate-50 border border-slate-200 p-6 relative overflow-hidden">
        <div className="flex flex-col h-full">
          <div className="text-xs font-semibold text-slate-800 mb-1">Form Analytics</div>
          <div className="text-[10px] text-slate-500 mb-4">Last 7 days</div>
          
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: "Views", value: "2,847", change: "+12%" },
              { label: "Submissions", value: "1,234", change: "+8%" },
              { label: "Rate", value: "43.3%", change: "+3%" }
            ].map((stat, i) => (
              <div key={i} className="bg-white rounded-lg border border-slate-200 p-2.5">
                <div className="text-[10px] text-slate-500">{stat.label}</div>
                <div className="text-sm font-bold text-slate-900">{stat.value}</div>
                <div className="text-[10px] text-emerald-600 font-medium">{stat.change}</div>
              </div>
            ))}
          </div>
          
          {/* Chart bars */}
          <div className="flex-1 flex items-end gap-2 px-2">
            {[40, 65, 45, 80, 55, 90, 70].map((h, i) => (
              <motion.div 
                key={i} 
                className="flex-1 bg-blue-500/20 rounded-t-md relative overflow-hidden"
                initial={{ height: 0 }}
                animate={{ height: `${h}%` }}
                transition={{ duration: 0.8, delay: i * 0.1, ease: "easeOut" }}
              >
                <motion.div 
                  className="absolute bottom-0 left-0 right-0 bg-blue-500 rounded-t-md"
                  initial={{ height: 0 }}
                  animate={{ height: `${h * 0.6}%` }}
                  transition={{ duration: 0.8, delay: i * 0.1 + 0.3, ease: "easeOut" }}
                />
              </motion.div>
            ))}
          </div>
          <div className="flex justify-between px-2 mt-2">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <div key={i} className="text-[9px] text-slate-400 font-medium flex-1 text-center">{d}</div>
            ))}
          </div>
        </div>
      </div>
    )
  },
  {
    id: 'item-5',
    title: 'Custom themes & branding',
    description: "Make every form feel like your own. Customize colors, fonts, logos, and layouts to match your brand identity. Choose from beautiful presets or build your own theme from scratch.",
    icon: Palette,
    visual: (
      <div className="w-full h-full rounded-2xl bg-gradient-to-br from-pink-50 to-slate-50 border border-slate-200 p-6 relative overflow-hidden flex items-center justify-center">
        {/* Theme cards */}
        <div className="flex gap-3 perspective-[1000px]">
          {[
            { name: "Minimal", bg: "bg-white", accent: "bg-slate-900", border: "border-slate-200" },
            { name: "Ocean", bg: "bg-blue-50", accent: "bg-blue-600", border: "border-blue-200" },
            { name: "Forest", bg: "bg-emerald-50", accent: "bg-emerald-600", border: "border-emerald-200" }
          ].map((theme, i) => (
            <motion.div 
              key={i}
              className={`w-28 ${theme.bg} rounded-xl border ${theme.border} p-3 flex flex-col gap-2 shadow-sm`}
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3, repeat: Infinity, delay: i * 0.4 }}
            >
              <div className={`w-full h-2 ${theme.accent} rounded-full`} />
              <div className="space-y-1.5">
                <div className="h-1.5 bg-slate-200 rounded-full w-3/4" />
                <div className="h-1.5 bg-slate-200 rounded-full w-1/2" />
              </div>
              <div className="h-5 bg-slate-100 rounded-md border border-slate-200 mt-1" />
              <div className={`h-5 ${theme.accent} rounded-md mt-auto`} />
              <div className="text-[9px] font-semibold text-slate-600 text-center mt-1">{theme.name}</div>
            </motion.div>
          ))}
        </div>
      </div>
    )
  }
];

export function FeatureShowcase() {
  const [activeItem, setActiveItem] = useState(showcaseItems[0].id);

  const currentItem = showcaseItems.find(item => item.id === activeItem);

  return (
    <div className="flex flex-col lg:flex-row gap-12 lg:gap-16 items-start">
      {/* Accordion Left Side */}
      <div className="w-full lg:w-[45%]">
        <Accordion 
          type="single" 
          value={activeItem} 
          onValueChange={(val) => {
            if (val) setActiveItem(val as string);
          }}
          className="w-full space-y-3"
        >
          {showcaseItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeItem === item.id;
            
            return (
              <AccordionItem 
                key={item.id} 
                value={item.id} 
                className={`border-b-0 px-5 py-1 rounded-2xl transition-all duration-300 ${isActive ? 'bg-white shadow-lg shadow-slate-200/60 border border-slate-100' : 'hover:bg-slate-50/70'}`}
              >
                <AccordionTrigger className="hover:no-underline py-4">
                  <div className="flex items-center gap-3.5 text-left">
                    <div className={`p-2 rounded-lg transition-colors duration-300 ${isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                      <Icon size={20} />
                    </div>
                    <span className={`text-base font-semibold transition-colors duration-300 ${isActive ? 'text-slate-900' : 'text-slate-600'}`}>
                      {item.title}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="text-slate-500 leading-relaxed text-sm pb-5 pt-1 pl-[3.25rem]">
                  {item.description}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>

      {/* Visual Right Side */}
      <div className="w-full lg:w-[55%] lg:sticky lg:top-24">
        <div className="aspect-[4/3] relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeItem}
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="w-full h-full absolute inset-0"
            >
              {currentItem?.visual}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
