namespace QRious.Application.Seeding;

/// <summary>Reference data: event categories, interests, skills, category suggestions and networking intentions.</summary>
public static class SeedData
{
    public sealed record Category(string Slug, string Name, string Description, string Image, string[] Interests, string[] Skills, (string Slug, string Label, string Group)[] Intentions);

    public static readonly Dictionary<string, string[]> Interests = new()
    {
        ["Music"] = ["Indie", "Rock", "Pop", "Jazz", "Classical", "Hip hop", "EDM", "Bollywood music", "Carnatic music", "Hindustani classical", "Metal", "Folk", "Lo-fi", "Live music", "Music festivals", "Jamming", "Songwriting", "Music production"],
        ["Arts & Culture"] = ["Painting", "Photography", "Street art", "Design", "Theatre", "Film", "Dance", "Poetry", "Literature", "Museums", "Fashion", "Architecture", "Crafts", "Calligraphy", "Stand-up comedy", "Anime"],
        ["Tech & Business"] = ["Startups", "Entrepreneurship", "Artificial intelligence", "Web3", "Product management", "Investing", "Marketing", "Open source", "Gaming", "Cybersecurity", "Robotics", "Data science", "Sustainability", "Social impact", "Fintech", "Edtech"],
        ["Lifestyle"] = ["Travel", "Food", "Coffee", "Cooking", "Fitness", "Yoga", "Running", "Cycling", "Trekking", "Meditation", "Books", "Podcasts", "Volunteering", "Pets", "Gardening", "Board games"],
        ["Sports"] = ["Cricket", "Football", "Basketball", "Badminton", "Tennis", "Chess", "Esports", "Swimming", "Martial arts", "Formula 1"],
        ["Social"] = ["Meeting new people", "Networking", "Community building", "Weddings", "Festivals", "Culture exchange", "Languages", "Mentorship"],
    };

    public static readonly Dictionary<string, string[]> Skills = new()
    {
        ["Music"] = ["Singing", "Guitar", "Bass guitar", "Drums", "Keyboard", "Piano", "Violin", "Flute", "Tabla", "DJing", "Music production", "Sound engineering", "Mixing & mastering", "Composing", "Rapping", "Beatboxing"],
        ["Creative"] = ["Dance", "Graphic design", "UI/UX design", "Illustration", "Photography", "Videography", "Video editing", "Animation", "3D modelling", "Content writing", "Copywriting", "Acting", "Choreography", "Fashion design", "Event photography", "Painting", "Storytelling"],
        ["Tech"] = ["Software development", "Web development", "Mobile development", "Frontend development", "Backend development", "Machine learning", "Data analysis", "Cloud computing", "DevOps", "Cybersecurity", "Blockchain", "Game development", "Product design", "Hardware & IoT", "No-code tools", "Prompt engineering"],
        ["Business"] = ["Product management", "Marketing", "Digital marketing", "Sales", "Business development", "Fundraising", "Finance", "Accounting", "Legal", "Operations", "Project management", "Public speaking", "Community management", "Social media management", "Brand strategy", "Event management", "Human resources", "Consulting"],
        ["People"] = ["Leadership", "Mentoring", "Teaching", "Networking", "Negotiation", "Hosting", "Translation", "Research"],
        ["Hospitality"] = ["Cooking", "Baking", "Bartending", "Event planning", "Decoration", "Makeup artistry"],
    };

    public static readonly (string Alias, string Canonical, bool IsSkill)[] Aliases =
    [
        ("ai", "Artificial intelligence", false),
        ("ml", "Machine learning", true),
        ("ux", "UI/UX design", true),
        ("ui", "UI/UX design", true),
        ("dj", "DJing", true),
        ("pm", "Product management", true),
        ("vocals", "Singing", true),
        ("vocalist", "Singing", true),
        ("singer", "Singing", true),
        ("guitarist", "Guitar", true),
        ("drummer", "Drums", true),
        ("coding", "Software development", true),
        ("programming", "Software development", true),
        ("photographer", "Photography", true),
        ("edm", "EDM", false),
        ("f1", "Formula 1", false),
    ];

    private static readonly (string, string, string)[] GlobalIntentions =
    [
        ("meet-new-people", "Interested in meeting new people", "social"),
        ("open-to-conversations", "Open to conversations", "social"),
        ("looking-for-collaborators", "Looking for collaborators", "collaboration"),
    ];

    public static readonly (string Slug, string Label, string Group)[] Global = GlobalIntentions;

    public static readonly Category[] Categories =
    [
        new("concert", "Concert", "Live music performances", "/images/categories/concert.webp",
            ["Live music", "Indie", "Rock", "Pop", "Music festivals", "Jamming", "Songwriting", "Music production"],
            ["Singing", "Guitar", "Drums", "Keyboard", "Bass guitar", "Music production", "DJing", "Sound engineering", "Composing", "Photography"],
            [("looking-for-singers", "Looking for singers", "collaboration"), ("looking-for-guitarists", "Looking for guitarists", "collaboration"),
             ("looking-for-jam-partners", "Looking for jam partners", "creative"), ("music-production-collab", "Music production collaboration", "creative")]),
        new("music-festival", "Music festival", "Multi-artist music festivals", "/images/categories/music-festival.webp",
            ["Music festivals", "EDM", "Live music", "Indie", "Hip hop", "Travel", "Meeting new people"],
            ["DJing", "Music production", "Singing", "Event photography", "Videography", "Sound engineering"],
            [("looking-for-singers", "Looking for singers", "collaboration"), ("looking-for-guitarists", "Looking for guitarists", "collaboration"),
             ("looking-for-jam-partners", "Looking for jam partners", "creative"), ("festival-buddies", "Looking for festival buddies", "social")]),
        new("wedding", "Wedding", "Weddings and receptions", "/images/categories/wedding.webp",
            ["Weddings", "Meeting new people", "Dance", "Food", "Travel", "Photography", "Bollywood music"],
            ["Dance", "Singing", "Photography", "Cooking", "Hosting", "Storytelling"],
            [("meet-other-guests", "Interested in meeting other guests", "social"), ("dance-partners", "Looking for dance partners", "social")]),
        new("social-gathering", "Social gathering", "Parties, meetups and get-togethers", "/images/categories/social-gathering.webp",
            ["Meeting new people", "Food", "Board games", "Travel", "Music festivals", "Books"],
            ["Hosting", "Cooking", "Storytelling", "Photography"],
            [("make-friends", "Looking to make new friends", "social")]),
        new("college-festival", "College festival", "Cultural and technical college fests", "/images/categories/college-festival.webp",
            ["Startups", "Gaming", "Dance", "Theatre", "Music festivals", "Artificial intelligence", "Meeting new people", "Robotics"],
            ["Software development", "Graphic design", "Public speaking", "Event management", "Video editing", "Singing", "Dance", "Choreography"],
            [("looking-for-teammates", "Looking for teammates", "collaboration"), ("project-collaborators", "Looking for project collaborators", "collaboration"),
             ("creative-collaboration", "Creative collaboration", "creative")]),
        new("conference", "Conference", "Professional and industry conferences", "/images/categories/conference.webp",
            ["Startups", "Entrepreneurship", "Artificial intelligence", "Investing", "Product management", "Marketing", "Networking", "Mentorship"],
            ["Product management", "Software development", "Business development", "Marketing", "Fundraising", "Public speaking", "Consulting", "Leadership"],
            [("looking-for-partners", "Looking for partners", "professional"), ("professional-networking", "Interested in professional networking", "professional"),
             ("business-collaborations", "Looking for business collaborations", "professional"), ("hiring", "Hiring", "professional"), ("job-seeking", "Exploring new roles", "professional")]),
        new("workshop", "Workshop", "Hands-on learning sessions", "/images/categories/workshop.webp",
            ["Design", "Artificial intelligence", "Photography", "Crafts", "Data science", "Open source"],
            ["Teaching", "Mentoring", "Software development", "UI/UX design", "Photography", "Research"],
            [("study-buddies", "Looking for study partners", "collaboration"), ("mentors", "Looking for mentors", "professional")]),
        new("business-meetup", "Business meetup", "Founder, investor and industry meetups", "/images/categories/business-meetup.webp",
            ["Startups", "Entrepreneurship", "Investing", "Fintech", "Marketing", "Networking", "Sustainability"],
            ["Business development", "Sales", "Fundraising", "Finance", "Marketing", "Legal", "Operations", "Brand strategy"],
            [("looking-for-partners", "Looking for partners", "professional"), ("looking-for-investors", "Looking for investors", "professional"),
             ("looking-for-cofounder", "Looking for a co-founder", "professional"), ("business-collaborations", "Looking for business collaborations", "professional")]),
        new("art-exhibition", "Art exhibition", "Galleries, exhibitions and art fairs", "/images/categories/art-exhibition.webp",
            ["Painting", "Photography", "Design", "Street art", "Museums", "Architecture", "Fashion", "Crafts"],
            ["Painting", "Illustration", "Photography", "Graphic design", "3D modelling", "Fashion design", "Storytelling"],
            [("creative-partnerships", "Looking for creative partnerships", "creative"), ("artists", "Looking to meet artists", "creative"),
             ("buying-art", "Interested in collecting art", "other")]),
        new("cultural-festival", "Cultural festival", "Cultural celebrations and fairs", "/images/categories/cultural-festival.webp",
            ["Festivals", "Dance", "Food", "Culture exchange", "Languages", "Folk", "Crafts", "Theatre"],
            ["Dance", "Singing", "Cooking", "Translation", "Storytelling", "Photography"],
            [("culture-exchange", "Interested in culture exchange", "social"), ("performers", "Looking for performers", "creative")]),
        new("community-gathering", "Community gathering", "Community events, clubs and volunteering", "/images/categories/community-gathering.webp",
            ["Community building", "Volunteering", "Social impact", "Sustainability", "Books", "Meeting new people"],
            ["Community management", "Event planning", "Teaching", "Mentoring", "Social media management"],
            [("volunteers", "Looking for volunteers", "collaboration"), ("local-friends", "Looking to meet locals", "social")]),
        new("sports-entertainment", "Sports & entertainment", "Matches, tournaments and shows", "/images/categories/sports-entertainment.webp",
            ["Cricket", "Football", "Basketball", "Esports", "Formula 1", "Fitness", "Running", "Chess"],
            ["Event photography", "Videography", "Hosting", "Social media management"],
            [("teammates", "Looking for teammates", "collaboration"), ("watch-party", "Looking for match buddies", "social")]),
        new("other", "Other", "Any other kind of event", "/images/categories/other.webp",
            ["Meeting new people", "Networking", "Travel", "Food", "Startups", "Music festivals"],
            ["Public speaking", "Photography", "Software development", "Marketing", "Event management"],
            []),
    ];
}
