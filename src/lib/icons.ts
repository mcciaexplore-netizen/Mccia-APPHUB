import {
  AppWindow, Award, BarChart3, BookOpen, Briefcase, Building2, Calculator, Calendar,
  CalendarCheck, Camera, ClipboardList, Cloud, CreditCard, Database, FileText, Files,
  FolderOpen, Globe, GraduationCap, Handshake, Headset, HeartHandshake, Home, Inbox,
  Landmark, Layers, LayoutDashboard, LifeBuoy, LineChart, Lock, Mail, Map, Megaphone,
  MessageSquare, Newspaper, Package, PieChart, Phone, Receipt, Scale, Search, Settings,
  Shield, ShoppingCart, Sparkles, Store, Target, Ticket, TrendingUp, Truck, UserCheck,
  UserPlus, Users, Wallet, Wrench, Zap, Factory, Banknote, Presentation, Mic, Video,
  type LucideIcon,
} from "lucide-react";

export const ICONS: Record<string, LucideIcon> = {
  AppWindow, Award, BarChart3, BookOpen, Briefcase, Building2, Calculator, Calendar,
  CalendarCheck, Camera, ClipboardList, Cloud, CreditCard, Database, FileText, Files,
  FolderOpen, Globe, GraduationCap, Handshake, Headset, HeartHandshake, Home, Inbox,
  Landmark, Layers, LayoutDashboard, LifeBuoy, LineChart, Lock, Mail, Map, Megaphone,
  MessageSquare, Newspaper, Package, PieChart, Phone, Receipt, Scale, Search, Settings,
  Shield, ShoppingCart, Sparkles, Store, Target, Ticket, TrendingUp, Truck, UserCheck,
  UserPlus, Users, Wallet, Wrench, Zap, Factory, Banknote, Presentation, Mic, Video,
};

export const ICON_NAMES = Object.keys(ICONS).sort();
export const DEFAULT_ICON = "AppWindow";
export const iconFor = (name: string): LucideIcon => ICONS[name] ?? AppWindow;
