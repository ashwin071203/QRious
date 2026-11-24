// Reference taxonomy required by the PRD (predefined interests/skills, event categories, networking intentions).
// This is NOT demo data: no organizations, events or people are created.
export const INTERESTS: Record<string, string[]> = {
  "Music": [
    "Indie",
    "Rock",
    "Pop",
    "Jazz",
    "Classical",
    "Hip hop",
    "EDM",
    "Bollywood music",
    "Carnatic music",
    "Hindustani classical",
    "Metal",
    "Folk",
    "Lo-fi",
    "Live music",
    "Music festivals",
    "Jamming",
    "Songwriting",
    "Music production"
  ],
  "Arts & Culture": [
    "Painting",
    "Photography",
    "Street art",
    "Design",
    "Theatre",
    "Film",
    "Dance",
    "Poetry",
    "Literature",
    "Museums",
    "Fashion",
    "Architecture",
    "Crafts",
    "Calligraphy",
    "Stand-up comedy",
    "Anime"
  ],
  "Tech & Business": [
    "Startups",
    "Entrepreneurship",
    "Artificial intelligence",
    "Web3",
    "Product management",
    "Investing",
    "Marketing",
    "Open source",
    "Gaming",
    "Cybersecurity",
    "Robotics",
    "Data science",
    "Sustainability",
    "Social impact",
    "Fintech",
    "Edtech"
  ],
  "Lifestyle": [
    "Travel",
    "Food",
    "Coffee",
    "Cooking",
    "Fitness",
    "Yoga",
    "Running",
    "Cycling",
    "Trekking",
    "Meditation",
    "Books",
    "Podcasts",
    "Volunteering",
    "Pets",
    "Gardening",
    "Board games"
  ],
  "Sports": [
    "Cricket",
    "Football",
    "Basketball",
    "Badminton",
    "Tennis",
    "Chess",
    "Esports",
    "Swimming",
    "Martial arts",
    "Formula 1"
  ],
  "Social": [
    "Meeting new people",
    "Networking",
    "Community building",
    "Weddings",
    "Festivals",
    "Culture exchange",
    "Languages",
    "Mentorship"
  ]
};

export const SKILLS: Record<string, string[]> = {
  "Music": [
    "Singing",
    "Guitar",
    "Bass guitar",
    "Drums",
    "Keyboard",
    "Piano",
    "Violin",
    "Flute",
    "Tabla",
    "DJing",
    "Music production",
    "Sound engineering",
    "Mixing & mastering",
    "Composing",
    "Rapping",
    "Beatboxing"
  ],
  "Creative": [
    "Dance",
    "Graphic design",
    "UI/UX design",
    "Illustration",
    "Photography",
    "Videography",
    "Video editing",
    "Animation",
    "3D modelling",
    "Content writing",
    "Copywriting",
    "Acting",
    "Choreography",
    "Fashion design",
    "Event photography",
    "Painting",
    "Storytelling"
  ],
  "Tech": [
    "Software development",
    "Web development",
    "Mobile development",
    "Frontend development",
    "Backend development",
    "Machine learning",
    "Data analysis",
    "Cloud computing",
    "DevOps",
    "Cybersecurity",
    "Blockchain",
    "Game development",
    "Product design",
    "Hardware & IoT",
    "No-code tools",
    "Prompt engineering"
  ],
  "Business": [
    "Product management",
    "Marketing",
    "Digital marketing",
    "Sales",
    "Business development",
    "Fundraising",
    "Finance",
    "Accounting",
    "Legal",
    "Operations",
    "Project management",
    "Public speaking",
    "Community management",
    "Social media management",
    "Brand strategy",
    "Event management",
    "Human resources",
    "Consulting"
  ],
  "People": [
    "Leadership",
    "Mentoring",
    "Teaching",
    "Networking",
    "Negotiation",
    "Hosting",
    "Translation",
    "Research"
  ],
  "Hospitality": [
    "Cooking",
    "Baking",
    "Bartending",
    "Event planning",
    "Decoration",
    "Makeup artistry"
  ]
};

export const ALIASES: [alias: string, canonical: string, isSkill: boolean][] = [["ai","Artificial intelligence",false],["ml","Machine learning",true],["ux","UI/UX design",true],["ui","UI/UX design",true],["dj","DJing",true],["pm","Product management",true],["vocals","Singing",true],["vocalist","Singing",true],["singer","Singing",true],["guitarist","Guitar",true],["drummer","Drums",true],["coding","Software development",true],["programming","Software development",true],["photographer","Photography",true],["edm","EDM",false],["f1","Formula 1",false]];

export const GLOBAL_INTENTIONS = [
  {
    "slug": "meet-new-people",
    "label": "Interested in meeting new people",
    "group": "social"
  },
  {
    "slug": "open-to-conversations",
    "label": "Open to conversations",
    "group": "social"
  },
  {
    "slug": "looking-for-collaborators",
    "label": "Looking for collaborators",
    "group": "collaboration"
  }
];

export const CATEGORIES: { slug: string; name: string; description: string; image: string; interests: string[]; skills: string[]; intentions: { slug: string; label: string; group: string }[] }[] = [
  {
    "slug": "concert",
    "name": "Concert",
    "description": "Live music performances",
    "image": "/images/categories/concert.webp",
    "interests": [
      "Live music",
      "Indie",
      "Rock",
      "Pop",
      "Music festivals",
      "Jamming",
      "Songwriting",
      "Music production"
    ],
    "skills": [
      "Singing",
      "Guitar",
      "Drums",
      "Keyboard",
      "Bass guitar",
      "Music production",
      "DJing",
      "Sound engineering",
      "Composing",
      "Photography"
    ],
    "intentions": [
      {
        "slug": "looking-for-singers",
        "label": "Looking for singers",
        "group": "collaboration"
      },
      {
        "slug": "looking-for-guitarists",
        "label": "Looking for guitarists",
        "group": "collaboration"
      },
      {
        "slug": "looking-for-jam-partners",
        "label": "Looking for jam partners",
        "group": "creative"
      },
      {
        "slug": "music-production-collab",
        "label": "Music production collaboration",
        "group": "creative"
      }
    ]
  },
  {
    "slug": "music-festival",
    "name": "Music festival",
    "description": "Multi-artist music festivals",
    "image": "/images/categories/music-festival.webp",
    "interests": [
      "Music festivals",
      "EDM",
      "Live music",
      "Indie",
      "Hip hop",
      "Travel",
      "Meeting new people"
    ],
    "skills": [
      "DJing",
      "Music production",
      "Singing",
      "Event photography",
      "Videography",
      "Sound engineering"
    ],
    "intentions": [
      {
        "slug": "looking-for-singers",
        "label": "Looking for singers",
        "group": "collaboration"
      },
      {
        "slug": "looking-for-guitarists",
        "label": "Looking for guitarists",
        "group": "collaboration"
      },
      {
        "slug": "looking-for-jam-partners",
        "label": "Looking for jam partners",
        "group": "creative"
      },
      {
        "slug": "festival-buddies",
        "label": "Looking for festival buddies",
        "group": "social"
      }
    ]
  },
  {
    "slug": "wedding",
    "name": "Wedding",
    "description": "Weddings and receptions",
    "image": "/images/categories/wedding.webp",
    "interests": [
      "Weddings",
      "Meeting new people",
      "Dance",
      "Food",
      "Travel",
      "Photography",
      "Bollywood music"
    ],
    "skills": [
      "Dance",
      "Singing",
      "Photography",
      "Cooking",
      "Hosting",
      "Storytelling"
    ],
    "intentions": [
      {
        "slug": "meet-other-guests",
        "label": "Interested in meeting other guests",
        "group": "social"
      },
      {
        "slug": "dance-partners",
        "label": "Looking for dance partners",
        "group": "social"
      }
    ]
  },
  {
    "slug": "social-gathering",
    "name": "Social gathering",
    "description": "Parties, meetups and get-togethers",
    "image": "/images/categories/social-gathering.webp",
    "interests": [
      "Meeting new people",
      "Food",
      "Board games",
      "Travel",
      "Music festivals",
      "Books"
    ],
    "skills": [
      "Hosting",
      "Cooking",
      "Storytelling",
      "Photography"
    ],
    "intentions": [
      {
        "slug": "make-friends",
        "label": "Looking to make new friends",
        "group": "social"
      }
    ]
  },
  {
    "slug": "college-festival",
    "name": "College festival",
    "description": "Cultural and technical college fests",
    "image": "/images/categories/college-festival.webp",
    "interests": [
      "Startups",
      "Gaming",
      "Dance",
      "Theatre",
      "Music festivals",
      "Artificial intelligence",
      "Meeting new people",
      "Robotics"
    ],
    "skills": [
      "Software development",
      "Graphic design",
      "Public speaking",
      "Event management",
      "Video editing",
      "Singing",
      "Dance",
      "Choreography"
    ],
    "intentions": [
      {
        "slug": "looking-for-teammates",
        "label": "Looking for teammates",
        "group": "collaboration"
      },
      {
        "slug": "project-collaborators",
        "label": "Looking for project collaborators",
        "group": "collaboration"
      },
      {
        "slug": "creative-collaboration",
        "label": "Creative collaboration",
        "group": "creative"
      }
    ]
  },
  {
    "slug": "conference",
    "name": "Conference",
    "description": "Professional and industry conferences",
    "image": "/images/categories/conference.webp",
    "interests": [
      "Startups",
      "Entrepreneurship",
      "Artificial intelligence",
      "Investing",
      "Product management",
      "Marketing",
      "Networking",
      "Mentorship"
    ],
    "skills": [
      "Product management",
      "Software development",
      "Business development",
      "Marketing",
      "Fundraising",
      "Public speaking",
      "Consulting",
      "Leadership"
    ],
    "intentions": [
      {
        "slug": "looking-for-partners",
        "label": "Looking for partners",
        "group": "professional"
      },
      {
        "slug": "professional-networking",
        "label": "Interested in professional networking",
        "group": "professional"
      },
      {
        "slug": "business-collaborations",
        "label": "Looking for business collaborations",
        "group": "professional"
      },
      {
        "slug": "hiring",
        "label": "Hiring",
        "group": "professional"
      },
      {
        "slug": "job-seeking",
        "label": "Exploring new roles",
        "group": "professional"
      }
    ]
  },
  {
    "slug": "workshop",
    "name": "Workshop",
    "description": "Hands-on learning sessions",
    "image": "/images/categories/workshop.webp",
    "interests": [
      "Design",
      "Artificial intelligence",
      "Photography",
      "Crafts",
      "Data science",
      "Open source"
    ],
    "skills": [
      "Teaching",
      "Mentoring",
      "Software development",
      "UI/UX design",
      "Photography",
      "Research"
    ],
    "intentions": [
      {
        "slug": "study-buddies",
        "label": "Looking for study partners",
        "group": "collaboration"
      },
      {
        "slug": "mentors",
        "label": "Looking for mentors",
        "group": "professional"
      }
    ]
  },
  {
    "slug": "business-meetup",
    "name": "Business meetup",
    "description": "Founder, investor and industry meetups",
    "image": "/images/categories/business-meetup.webp",
    "interests": [
      "Startups",
      "Entrepreneurship",
      "Investing",
      "Fintech",
      "Marketing",
      "Networking",
      "Sustainability"
    ],
    "skills": [
      "Business development",
      "Sales",
      "Fundraising",
      "Finance",
      "Marketing",
      "Legal",
      "Operations",
      "Brand strategy"
    ],
    "intentions": [
      {
        "slug": "looking-for-partners",
        "label": "Looking for partners",
        "group": "professional"
      },
      {
        "slug": "looking-for-investors",
        "label": "Looking for investors",
        "group": "professional"
      },
      {
        "slug": "looking-for-cofounder",
        "label": "Looking for a co-founder",
        "group": "professional"
      },
      {
        "slug": "business-collaborations",
        "label": "Looking for business collaborations",
        "group": "professional"
      }
    ]
  },
  {
    "slug": "art-exhibition",
    "name": "Art exhibition",
    "description": "Galleries, exhibitions and art fairs",
    "image": "/images/categories/art-exhibition.webp",
    "interests": [
      "Painting",
      "Photography",
      "Design",
      "Street art",
      "Museums",
      "Architecture",
      "Fashion",
      "Crafts"
    ],
    "skills": [
      "Painting",
      "Illustration",
      "Photography",
      "Graphic design",
      "3D modelling",
      "Fashion design",
      "Storytelling"
    ],
    "intentions": [
      {
        "slug": "creative-partnerships",
        "label": "Looking for creative partnerships",
        "group": "creative"
      },
      {
        "slug": "artists",
        "label": "Looking to meet artists",
        "group": "creative"
      },
      {
        "slug": "buying-art",
        "label": "Interested in collecting art",
        "group": "other"
      }
    ]
  },
  {
    "slug": "cultural-festival",
    "name": "Cultural festival",
    "description": "Cultural celebrations and fairs",
    "image": "/images/categories/cultural-festival.webp",
    "interests": [
      "Festivals",
      "Dance",
      "Food",
      "Culture exchange",
      "Languages",
      "Folk",
      "Crafts",
      "Theatre"
    ],
    "skills": [
      "Dance",
      "Singing",
      "Cooking",
      "Translation",
      "Storytelling",
      "Photography"
    ],
    "intentions": [
      {
        "slug": "culture-exchange",
        "label": "Interested in culture exchange",
        "group": "social"
      },
      {
        "slug": "performers",
        "label": "Looking for performers",
        "group": "creative"
      }
    ]
  },
  {
    "slug": "community-gathering",
    "name": "Community gathering",
    "description": "Community events, clubs and volunteering",
    "image": "/images/categories/community-gathering.webp",
    "interests": [
      "Community building",
      "Volunteering",
      "Social impact",
      "Sustainability",
      "Books",
      "Meeting new people"
    ],
    "skills": [
      "Community management",
      "Event planning",
      "Teaching",
      "Mentoring",
      "Social media management"
    ],
    "intentions": [
      {
        "slug": "volunteers",
        "label": "Looking for volunteers",
        "group": "collaboration"
      },
      {
        "slug": "local-friends",
        "label": "Looking to meet locals",
        "group": "social"
      }
    ]
  },
  {
    "slug": "sports-entertainment",
    "name": "Sports & entertainment",
    "description": "Matches, tournaments and shows",
    "image": "/images/categories/sports-entertainment.webp",
    "interests": [
      "Cricket",
      "Football",
      "Basketball",
      "Esports",
      "Formula 1",
      "Fitness",
      "Running",
      "Chess"
    ],
    "skills": [
      "Event photography",
      "Videography",
      "Hosting",
      "Social media management"
    ],
    "intentions": [
      {
        "slug": "teammates",
        "label": "Looking for teammates",
        "group": "collaboration"
      },
      {
        "slug": "watch-party",
        "label": "Looking for match buddies",
        "group": "social"
      }
    ]
  },
  {
    "slug": "other",
    "name": "Other",
    "description": "Any other kind of event",
    "image": "/images/categories/other.webp",
    "interests": [
      "Meeting new people",
      "Networking",
      "Travel",
      "Food",
      "Startups",
      "Music festivals"
    ],
    "skills": [
      "Public speaking",
      "Photography",
      "Software development",
      "Marketing",
      "Event management"
    ],
    "intentions": []
  }
];
