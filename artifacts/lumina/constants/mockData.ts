import { ImageSourcePropType } from "react-native";

export const CREATORS = {
  ALEX: {
    id: "c1",
    name: "Alex",
    location: "Brooklyn, NY",
    niche: "Fitness & Lifestyle",
    followers: 11400,
    currency: "USD",
    image: require("@/assets/images/creator-1.png") as ImageSourcePropType,
  },
  PRIYA: {
    id: "c2",
    name: "Priya",
    location: "Austin, TX",
    niche: "Beauty & GRWM",
    followers: 8700,
    currency: "USD",
    image: require("@/assets/images/creator-2.png") as ImageSourcePropType,
  },
  JAMES: {
    id: "c3",
    name: "James",
    location: "London, UK",
    niche: "Tech & Productivity",
    followers: 15300,
    currency: "GBP",
    image: require("@/assets/images/creator-3.png") as ImageSourcePropType,
  },
};

export const CURRENT_USER = CREATORS.ALEX;

export const TREND_BRIEFS = [
  {
    id: "t1",
    title: "Y2K Revival Thrift Haul",
    context: "US Gen-Z · trending sound",
    viralPotential: 92,
    description: "A fast-paced thrift flip using the trending audio everyone in NYC is using this week.",
    image: require("@/assets/images/creator-1.png"),
  },
  {
    id: "t2",
    title: "Hidden Gem: Brooklyn Matcha",
    context: "US lifestyle · aesthetic cafe",
    viralPotential: 85,
    description: "Cinematic shots of the new matcha place in Williamsburg, GRWM-style narration.",
    image: require("@/assets/images/creator-2.png"),
  },
  {
    id: "t3",
    title: "Get Ready With Me: Night Out",
    context: "US Gen-Z · GRWM storytime",
    viralPotential: 78,
    description: "Chatty GRWM talking about the craziest going-out story.",
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
    title: "Brooklyn Matcha Review",
    status: "Ready",
    viralScore: 94,
    reasoning: "94% — high engagement expected on aesthetic cafe content for US Gen-Z.",
    thumbnail: require("@/assets/images/creator-2.png"),
    agents: {
      Ideator: "done",
      Director: "done",
      Editor: "done",
      Monetizer: "done",
    },
    script: "Hook: Is this the best matcha in NYC?\n\nBody: I went to the new hidden cafe in Williamsburg. The aesthetic is 10/10 and the matcha is imported straight from Kyoto.\n\nCTA: Tag who you're taking here!",
  },
  {
    id: "v3",
    title: "GRWM: NYFW Edition",
    status: "Ideating",
    viralScore: null,
    reasoning: "Analyzing current trends for New York Fashion Week...",
    thumbnail: require("@/assets/images/creator-3.png"),
    agents: {
      Ideator: "active",
      Director: "pending",
      Editor: "pending",
      Monetizer: "pending",
    },
    script: "Generating script based on latest NYFW trends...",
  },
];

export const EARNINGS = {
  currentMonth: 1850,
  currency: "USD",
  growth: "+15%",
  deals: [
    { id: "d1", brand: "Gymshark", status: "Signed", amount: 750 },
    { id: "d2", brand: "Glossier", status: "Negotiating", amount: 1200 },
    { id: "d3", brand: "Alo Yoga", status: "Paid", amount: 400 },
  ],
  history: [820, 1050, 980, 1320, 1180, 1640, 1850],
};
