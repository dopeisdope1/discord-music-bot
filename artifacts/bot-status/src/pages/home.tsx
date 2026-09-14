import { motion } from 'framer-motion';
import { useServiceStatus } from '@/hooks/use-service-status';
import { Activity, ServerOff, Loader2 } from 'lucide-react';
import { FeaturesGrid } from '@/components/features-grid';

function StatusBadge() {
  const { data: status } = useServiceStatus();

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="inline-flex items-center gap-3 px-5 py-2.5 rounded-full glass-panel"
    >
      <div className="relative flex h-3 w-3 items-center justify-center">
        {status === 'online' && (
          <>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
          </>
        )}
        {status === 'offline' && (
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive"></span>
        )}
        {status === 'checking' && (
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse"></span>
        )}
      </div>
      
      <span className="text-sm font-medium tracking-wide">
        {status === 'online' && 'Tous les systèmes sont opérationnels'}
        {status === 'offline' && 'Service temporairement indisponible'}
        {status === 'checking' && "Vérification de l'état..."}
      </span>

      <div className="w-px h-4 bg-border mx-1" />

      {status === 'online' && <Activity className="w-4 h-4 text-emerald-500" />}
      {status === 'offline' && <ServerOff className="w-4 h-4 text-destructive" />}
      {status === 'checking' && <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />}
    </motion.div>
  );
}

export default function Home() {
  return (
    <div className="min-h-[100dvh] w-full relative overflow-hidden bg-grid-pattern selection:bg-primary/20">
      {/* Animated background blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/20 blur-[120px] mix-blend-multiply dark:mix-blend-lighten animate-blob pointer-events-none" />
      <div className="absolute top-[20%] right-[-10%] w-[40%] h-[40%] rounded-full bg-accent/20 blur-[120px] mix-blend-multiply dark:mix-blend-lighten animate-blob pointer-events-none" style={{ animationDelay: '2s' }} />
      <div className="absolute bottom-[-20%] left-[20%] w-[50%] h-[50%] rounded-full bg-blue-500/20 blur-[120px] mix-blend-multiply dark:mix-blend-lighten animate-blob pointer-events-none" style={{ animationDelay: '4s' }} />

      <main className="relative z-10 flex flex-col items-center pt-32 pb-16">
        <div className="text-center px-6 max-w-4xl mx-auto space-y-8">
          <StatusBadge />

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="space-y-4"
          >
            <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-foreground drop-shadow-sm">
              zinki<span className="text-primary opacity-60">#1175</span>
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground font-medium max-w-2xl mx-auto leading-relaxed">
              Le compagnon indispensable pour votre communauté Discord.
            </p>
          </motion.div>
        </div>

        <FeaturesGrid />
        
        <motion.footer 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.8 }}
          className="mt-12 text-center text-sm text-muted-foreground"
        >
          <p>Rafraîchissement automatique du statut en temps réel.</p>
        </motion.footer>
      </main>
    </div>
  );
}
