import { Music, Shield, Lock, Mic, Ticket, Gift, type LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';

interface FeatureCardProps {
  title: string;
  description: string;
  Icon: LucideIcon;
  delay: number;
}

function FeatureCard({ title, description, Icon, delay }: FeatureCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.25, 0.1, 0.25, 1] }}
      className="group relative overflow-hidden rounded-3xl glass-panel p-8 hover:bg-white/90 dark:hover:bg-black/60 transition-colors duration-500"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      
      <div className="relative z-10 flex flex-col items-start gap-4">
        <div className="p-3 rounded-2xl bg-primary/10 text-primary group-hover:scale-110 transition-transform duration-500">
          <Icon className="w-6 h-6" />
        </div>
        
        <div className="space-y-2">
          <h3 className="text-xl font-bold font-display text-foreground">{title}</h3>
          <p className="text-muted-foreground leading-relaxed">
            {description}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export function FeaturesGrid() {
  const features = [
    {
      title: 'Musique',
      description: 'Qualité audio exceptionnelle. Jouez vos morceaux préférés avec une fluidité parfaite et sans interruption.',
      Icon: Music,
    },
    {
      title: 'Modération',
      description: 'Gardez le contrôle absolu. Outils avancés et personnalisables pour maintenir la paix sur votre serveur.',
      Icon: Shield,
    },
    {
      title: 'Sécurité',
      description: 'Protection anti-raid, filtres automatiques et logs détaillés pour une communauté toujours saine et sûre.',
      Icon: Lock,
    },
    {
      title: 'Salons Vocaux',
      description: 'Des espaces éphémères qui se créent et disparaissent selon vos besoins. Fini les canaux vides.',
      Icon: Mic,
    },
    {
      title: 'Tickets',
      description: 'Support organisé et professionnel. Gérez les demandes de vos membres en toute simplicité.',
      Icon: Ticket,
    },
    {
      title: 'Giveaways',
      description: 'Animez votre communauté avec un système de concours complet, équitable et hautement configurable.',
      Icon: Gift,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-6xl mx-auto px-6 py-24 relative z-10">
      {features.map((feature, idx) => (
        <FeatureCard 
          key={feature.title}
          title={feature.title}
          description={feature.description}
          Icon={feature.Icon}
          delay={0.2 + idx * 0.1}
        />
      ))}
    </div>
  );
}
