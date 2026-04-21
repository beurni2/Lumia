import { ImageSourcePropType } from "react-native";

export const CREATORS = {
  MARIA: {
    id: "c1",
    name: "Maria",
    location: "São Paulo",
    niche: "Fashion & Lifestyle",
    followers: 42500,
    currency: "BRL",
    image: require("@/assets/images/creator-1.png") as ImageSourcePropType,
  },
  RIAN: {
    id: "c2",
    name: "Rian",
    location: "Jakarta",
    niche: "Street Food",
    followers: 28100,
    currency: "IDR",
    image: require("@/assets/images/creator-2.png") as ImageSourcePropType,
  },
  SOFIA: {
    id: "c3",
    name: "Sofia",
    location: "Mexico City",
    niche: "Beauty & Makeup",
    followers: 15300,
    currency: "MXN",
    image: require("@/assets/images/creator-3.png") as ImageSourcePropType,
  },
};

export const CURRENT_USER = CREATORS.MARIA;

export const TREND_BRIEFS = [
  {
    id: "t1",
    title: "Y2K Revival Thrift Haul",
    context: "São Paulo · funk beat",
    viralPotential: 92,
    description: "A fast-paced thrift flip using the trending 'Tubarão Te Amo' audio.",
    image: require("@/assets/images/creator-1.png"),
  },
  {
    id: "t2",
    title: "Hidden Gem: Liberdade",
    context: "São Paulo · aesthetic cafe",
    viralPotential: 85,
    description: "Cinematic shots of the new matcha place in Liberdade.",
    image: require("@/assets/images/creator-2.png"),
  },
  {
    id: "t3",
    title: "Get Ready With Me: Night Out",
    context: "Brazil · GRWM storytime",
    viralPotential: 78,
    description: "Chatty GRWM talking about the craziest clubbing experience.",
    image: require("@/assets/images/creator-3.png"),
  },
];

export const VIDEOS = [
  {
    id: "v1",
    title: "Thrift Flip: 90s Cargo Pants",
    status: "Editing",
    viralScore: 87,
    reasoning: "87% — matches the fast-cut style your audience loved last week.",
    thumbnail: require("@/assets/images/creator-1.png"),
    agents: {
      Ideator: "done",
      Director: "done",
      Editor: "active",
      Monetizer: "pending",
    },
    script: "Hook: You won't believe what I found at the thrift store today...\n\nBody: Watch me turn these baggy 90s cargos into the perfect low-waist fit.\n\nCTA: Follow for the final look!",
  },
  {
    id: "v2",
    title: "Liberdade Matcha Review",
    status: "Ready",
    viralScore: 94,
    reasoning: "94% — high engagement expected on aesthetic cafe content in SP.",
    thumbnail: require("@/assets/images/creator-2.png"),
    agents: {
      Ideator: "done",
      Director: "done",
      Editor: "done",
      Monetizer: "done",
    },
    script: "Hook: Is this the best matcha in São Paulo?\n\nBody: I went to the new hidden cafe in Liberdade. The aesthetic is 10/10 and the matcha is imported straight from Kyoto.\n\nCTA: Tag who you're taking here!",
  },
  {
    id: "v3",
    title: "GRWM: SPFW Edition",
    status: "Ideating",
    viralScore: null,
    reasoning: "Analyzing current trends for São Paulo Fashion Week...",
    thumbnail: require("@/assets/images/creator-3.png"),
    agents: {
      Ideator: "active",
      Director: "pending",
      Editor: "pending",
      Monetizer: "pending",
    },
    script: "Generating script based on latest SPFW trends...",
  },
];

export const EARNINGS = {
  currentMonth: 4250,
  currency: "BRL",
  growth: "+15%",
  deals: [
    { id: "d1", brand: "O Boticário", status: "Signed", amount: 1500 },
    { id: "d2", brand: "Amaro", status: "Negotiating", amount: 2000 },
    { id: "d3", brand: "C&A", status: "Paid", amount: 800 },
  ],
  history: [2000, 2500, 2200, 3100, 2800, 3800, 4250],
};
