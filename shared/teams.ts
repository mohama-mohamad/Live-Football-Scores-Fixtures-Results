// قاموس أسماء الفرق بالعربية. المفتاح هو الاسم الإنجليزي بعد "التطبيع"
// (أحرف صغيرة، بدون FC/CF/SC، بدون شرطات أو نقاط). يمكن إضافة أكثر من اسم
// إنجليزي لنفس الفريق مفصولة بـ "|".
// الفريق غير الموجود في القاموس يظهر باسمه الأصلي.

const RAW: Record<string, string> = {
  // السعودية
  'al hilal|al hilal saudi|alhilal': 'الهلال',
  'al nassr|al nassr riyadh|alnassr': 'النصر',
  'al ittihad|al ittihad jeddah|al ittihad club': 'الاتحاد',
  'al ahli|al ahli saudi|al ahli jeddah': 'الأهلي',
  'al shabab|al shabab riyadh': 'الشباب',
  'al ettifaq|al ettifaq dammam|al ittifaq': 'الاتفاق',
  'al taawoun|al taawon': 'التعاون',
  'al fateh': 'الفتح',
  'al fayha': 'الفيحاء',
  'al raed': 'الرائد',
  'al khaleej|al khaleej saihat': 'الخليج',
  'al wehda|al wahda mecca': 'الوحدة',
  'damac': 'ضمك',
  'al riyadh': 'الرياض',
  'al okhdood|al akhdoud': 'الأخدود',
  'al qadisiyah|al qadsiah|al qadisiya': 'القادسية',
  'al orobah|al orubah': 'العروبة',
  'al kholood': 'الخلود',
  'al najma|al najmah': 'النجمة',
  'neom': 'نيوم',
  'al hazem|al hazm': 'الحزم',
  'abha': 'أبها',
  'al tai|al taee': 'الطائي',
  // مصر
  'al ahly|al ahly cairo|al ahly sc': 'الأهلي',
  'zamalek|zamalek sc': 'الزمالك',
  'pyramids|pyramids fc': 'بيراميدز',
  'al masry': 'المصري',
  'ismaily': 'الإسماعيلي',
  'future|modern sport|modern future': 'مودرن سبورت',
  'ceramica cleopatra': 'سيراميكا كليوباترا',
  'enppi': 'إنبي',
  'el gouna': 'الجونة',
  'smouha': 'سموحة',
  'al ittihad alexandria|ittihad alexandria': 'الاتحاد السكندري',
  'zed': 'زد',
  'pharco': 'فاركو',
  'ghazl el mahalla': 'غزل المحلة',
  'national bank of egypt|national bank': 'البنك الأهلي',
  'tala ea el gaish|talaea el gaish': 'طلائع الجيش',
  'el mokawloon|arab contractors': 'المقاولون العرب',
  'petrojet': 'بتروجت',
  'haras el hodood': 'حرس الحدود',
  'el gaish': 'الجيش',
  // المغرب وتونس والجزائر
  'wydad|wydad casablanca|wydad ac': 'الوداد',
  'raja|raja casablanca': 'الرجاء',
  'far rabat|as far': 'الجيش الملكي',
  'rs berkane|berkane': 'نهضة بركان',
  'esperance tunis|esperance de tunis|est': 'الترجي',
  'etoile du sahel': 'النجم الساحلي',
  'club africain': 'الإفريقي',
  'cs sfaxien': 'الصفاقسي',
  'mc alger': 'مولودية الجزائر',
  'cr belouizdad': 'شباب بلوزداد',
  'js kabylie': 'شبيبة القبائل',
  'kawkab marrakech': 'الكوكب المراكشي',
  'ittihad tanger|ir tanger': 'اتحاد طنجة',
  'amal tiznit': 'أمل تيزنيت',
  'difaa el jadida|dhj': 'الدفاع الحسني الجديدي',
  'maghreb fes|mas fes': 'المغرب الفاسي',
  'hassania agadir': 'حسنية أكادير',
  'olympic safi|olympique safi': 'أولمبيك آسفي',
  'fus rabat': 'الفتح الرباطي',
  'union touarga': 'اتحاد تواركة',
  'moghreb tetouan': 'المغرب التطواني',
  'renaissance zemamra|rca zemamra': 'نهضة الزمامرة',
  'chabab mohammedia': 'شباب المحمدية',
  'mamelodi sundowns': 'ماميلودي صنداونز',
  'tp mazembe': 'مازيمبي',
  // الإمارات وقطر
  'al ain': 'العين',
  'al wahda|al wahda abu dhabi': 'الوحدة',
  'al jazira|al jazira abu dhabi': 'الجزيرة',
  'shabab al ahli|shabab al ahli dubai': 'شباب الأهلي',
  'sharjah|al sharjah': 'الشارقة',
  'al nasr dubai|al nasr': 'النصر الإماراتي',
  'al wasl': 'الوصل',
  'al sadd': 'السد',
  'al duhail': 'الدحيل',
  'al rayyan': 'الريان',
  'al gharafa': 'الغرافة',
  'al arabi|al arabi sc': 'العربي',
  'qatar sc': 'قطر',
  'al wakrah': 'الوكرة',
  'al ahli doha': 'الأهلي القطري',
  'al shahaniya': 'الشحانية',
  'al sailiya': 'السيلية',
  'lusail city|lusail': 'لوسيل',
  'al khor': 'الخور',
  'umm salal': 'أم صلال',
  'al shamal': 'الشمال',
  'al markhiya': 'المرخية',
  'ajman': 'عجمان',
  'baniyas|bani yas': 'بني ياس',
  'khor fakkan|khorfakkan': 'خورفكان',
  'al bataeh': 'البطائح',
  'ittihad kalba|kalba': 'اتحاد كلباء',
  'al dhafra': 'الظفرة',
  'dibba|dibba al fujairah': 'دبا الفجيرة',
  'al urooba': 'العروبة الإماراتي',
  // إنجلترا
  'arsenal': 'آرسنال',
  'aston villa': 'أستون فيلا',
  'bournemouth|afc bournemouth': 'بورنموث',
  'brentford': 'برينتفورد',
  'brighton|brighton hove albion|brighton and hove albion|brighton & hove albion|brighton hove': 'برايتون',
  'burnley': 'بيرنلي',
  'chelsea': 'تشيلسي',
  'crystal palace': 'كريستال بالاس',
  'everton': 'إيفرتون',
  'fulham': 'فولهام',
  'leeds|leeds united': 'ليدز يونايتد',
  'liverpool': 'ليفربول',
  'manchester city|man city': 'مانشستر سيتي',
  'manchester united|man united|manchester utd': 'مانشستر يونايتد',
  'newcastle|newcastle united': 'نيوكاسل',
  'nottingham forest': 'نوتنغهام فورست',
  'sunderland': 'سندرلاند',
  'tottenham|tottenham hotspur': 'توتنهام',
  'west ham|west ham united': 'وست هام',
  'wolves|wolverhampton|wolverhampton wanderers': 'وولفرهامبتون',
  'leicester|leicester city': 'ليستر سيتي',
  'southampton': 'ساوثهامبتون',
  'ipswich|ipswich town': 'إبسويتش',
  'hull city|hull': 'هال سيتي',
  'coventry city|coventry': 'كوفنتري سيتي',
  'norwich|norwich city': 'نوريتش',
  'sheffield utd|sheffield united': 'شيفيلد يونايتد',
  'watford': 'واتفورد',
  // إسبانيا
  'real madrid': 'ريال مدريد',
  'barcelona': 'برشلونة',
  'atletico madrid|atletico de madrid|club atletico de madrid|atleti': 'أتلتيكو مدريد',
  'athletic club|athletic bilbao': 'أتلتيك بلباو',
  'real sociedad': 'ريال سوسيداد',
  'real betis|betis': 'ريال بيتيس',
  'sevilla': 'إشبيلية',
  'valencia': 'فالنسيا',
  'villarreal': 'فياريال',
  'girona': 'جيرونا',
  'celta vigo|celta': 'سيلتا فيغو',
  'osasuna': 'أوساسونا',
  'getafe': 'خيتافي',
  'mallorca': 'مايوركا',
  'rayo vallecano': 'رايو فاييكانو',
  'alaves': 'ألافيس',
  'espanyol': 'إسبانيول',
  'levante': 'ليفانتي',
  'elche': 'إلتشي',
  'malaga|malaga cf': 'ملقة',
  'deportivo la coruna|rc deportivo la coruna|deportivo': 'ديبورتيفو لاكورونيا',
  'racing santander|real racing club de santander|santander': 'راسينغ سانتاندير',
  'real oviedo|oviedo': 'ريال أوفييدو',
  // إيطاليا
  'inter|inter milan|internazionale': 'إنتر ميلان',
  'ac milan|milan': 'ميلان',
  'juventus': 'يوفنتوس',
  'napoli': 'نابولي',
  'as roma|roma': 'روما',
  'lazio': 'لاتسيو',
  'atalanta': 'أتالانتا',
  'fiorentina': 'فيورنتينا',
  'bologna': 'بولونيا',
  'torino': 'تورينو',
  'udinese': 'أودينيزي',
  'genoa': 'جنوى',
  'como|como 1907': 'كومو',
  'cagliari': 'كالياري',
  'lecce': 'ليتشي',
  'parma': 'بارما',
  'sassuolo': 'ساسولو',
  'verona|hellas verona': 'فيرونا',
  'cremonese': 'كريمونيزي',
  'pisa': 'بيزا',
  'frosinone': 'فروزينوني',
  'empoli': 'إمبولي',
  'venezia': 'فينيسيا',
  'monza': 'مونزا',
  'sassuolo calcio': 'ساسولو',
  // ألمانيا
  'bayern munich|bayern munchen|bayern': 'بايرن ميونخ',
  'borussia dortmund|dortmund': 'بوروسيا دورتموند',
  'bayer leverkusen|leverkusen': 'باير ليفركوزن',
  'rb leipzig|leipzig': 'لايبزيغ',
  'eintracht frankfurt': 'آينتراخت فرانكفورت',
  'vfb stuttgart|stuttgart': 'شتوتغارت',
  'borussia monchengladbach|monchengladbach': 'بوروسيا مونشنغلادباخ',
  'vfl wolfsburg|wolfsburg': 'فولفسبورغ',
  'sc freiburg|freiburg': 'فرايبورغ',
  'werder bremen|sv werder bremen|bremen': 'فيردر بريمن',
  'union berlin': 'يونيون برلين',
  'mainz|mainz 05|fsv mainz 05': 'ماينتس',
  'hoffenheim|1899 hoffenheim': 'هوفنهايم',
  'augsburg|fc augsburg': 'أوغسبورغ',
  'hamburger sv|hamburg': 'هامبورغ',
  'koln|1 fc koln|fc koln': 'كولن',
  'schalke 04|fc schalke 04|schalke': 'شالكه',
  'sc paderborn 07|paderborn': 'بادربورن',
  'sv elversberg|elversberg': 'إلفرسبيرغ',
  'heidenheim|1 fc heidenheim': 'هايدنهايم',
  'st pauli|fc st pauli': 'سانت باولي',
  'bochum|vfl bochum': 'بوخوم',
  'holstein kiel': 'هولشتاين كيل',
  // فرنسا
  'paris saint germain|psg|paris sg': 'باريس سان جيرمان',
  'marseille|olympique marseille': 'مارسيليا',
  'lyon|olympique lyonnais': 'ليون',
  'monaco|as monaco': 'موناكو',
  'lille': 'ليل',
  'nice|ogc nice': 'نيس',
  'lens|rc lens': 'لانس',
  'rennes|stade rennais': 'رين',
  'nantes': 'نانت',
  'strasbourg': 'ستراسبورغ',
  'toulouse': 'تولوز',
  'brest|stade brestois 29': 'بريست',
  'paris fc': 'باريس إف سي',
  'le havre': 'لوهافر',
  'angers|angers sco': 'أنجيه',
  'lorient': 'لوريان',
  'le mans': 'لومان',
  'auxerre': 'أوكسير',
  'metz': 'ميتز',
  'saint etienne': 'سانت إتيان',
  'montpellier': 'مونبلييه',
  'reims|stade de reims': 'ريمس',
  'troyes|es troyes ac': 'تروا',
  // البرتغال وهولندا وغيرها
  'benfica': 'بنفيكا',
  'porto|fc porto': 'بورتو',
  'sporting cp|sporting lisbon|sporting': 'سبورتينغ لشبونة',
  'ajax': 'أياكس',
  'psv|psv eindhoven': 'آيندهوفن',
  'feyenoord': 'فينورد',
  'galatasaray': 'غلطة سراي',
  'fenerbahce': 'فنربخشة',
  'celtic': 'سلتيك',
  'club brugge|club brugge kv': 'كلوب بروج',
  'slavia praha|sk slavia praha|slavia prague': 'سلافيا براغ',
  'shakhtar donetsk|fk shakhtar donetsk|shakhtar|shaktar': 'شاختار دونيتسك',
  'aek athens|pae aek|aek athens fc': 'إيك أثينا',
  'lask|lask linz': 'لاسك لينز',
  'viking|viking fk': 'فايكنغ',
  'bodo glimt|bodø glimt|fk bodø glimt|fk bodo glimt': 'بودو غليمت',
  'slovan bratislava|sk slovan bratislava|sl bratislava': 'سلوفان براتيسلافا',
  'sabah|sabah fk': 'صباح',
  'sporting clube de portugal': 'سبورتينغ لشبونة',
  'feyenoord rotterdam': 'فينورد',
  'galatasaray sk': 'غلطة سراي',
  'fenerbahce sk': 'فنربخشة',
  // منتخبات
  'saudi arabia': 'السعودية',
  'egypt': 'مصر',
  'morocco': 'المغرب',
  'algeria': 'الجزائر',
  'tunisia': 'تونس',
  'qatar': 'قطر',
  'united arab emirates|uae': 'الإمارات',
  'iraq': 'العراق',
  'jordan': 'الأردن',
  'kuwait': 'الكويت',
  'oman': 'عُمان',
  'bahrain': 'البحرين',
  'syria': 'سوريا',
  'lebanon': 'لبنان',
  'palestine': 'فلسطين',
  'libya': 'ليبيا',
  'sudan': 'السودان',
  'yemen': 'اليمن',
  'brazil': 'البرازيل',
  'argentina': 'الأرجنتين',
  'france': 'فرنسا',
  'england': 'إنجلترا',
  'spain': 'إسبانيا',
  'germany': 'ألمانيا',
  'italy': 'إيطاليا',
  'portugal': 'البرتغال',
  'netherlands': 'هولندا',
  'belgium': 'بلجيكا',
  'croatia': 'كرواتيا',
  'japan': 'اليابان',
  'south korea|korea republic': 'كوريا الجنوبية',
  'usa|united states': 'الولايات المتحدة',
  'mexico': 'المكسيك',
  'senegal': 'السنغال',
  'nigeria': 'نيجيريا',
  'cameroon': 'الكاميرون',
  'ivory coast|cote d ivoire': 'ساحل العاج',
  'ghana': 'غانا',
};

// معرّفات فرق football-data.org تُزاح بهذا المقدار (لا تتداخل مع معرّفات API-Football)
export const SECONDARY_TEAM_OFFSET = 50_000_000;
// ومعرّفات مبارياته (football-data.org) بهذا المقدار
export const SECONDARY_MATCH_OFFSET = 900_000_000;

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// يحذف اللواحق الشائعة (FC، CF...) للمطابقة الثانية
function stripSuffixes(n: string): string {
  return n
    .replace(/^(fc|cf|sc|afc) /, '')
    .replace(/ (fc|cf|sc|afc|ac)$/, '')
    .trim();
}

const DICT = new Map<string, string>();
const arCount = new Map<string, number>();
for (const [keys, ar] of Object.entries(RAW)) {
  for (const k of keys.split('|')) DICT.set(normalizeName(k), ar);
  arCount.set(ar, (arCount.get(ar) ?? 0) + 1);
}

// أسماء عربية يحملها أكثر من فريق (مثل «الأهلي» السعودي والمصري): لا تصلح للمطابقة بالاسم
export const isAmbiguousKey = (key: string) => (arCount.get(key) ?? 0) > 1;

// هل يوجد اسم عربي لهذا الفريق؟
function lookup(name?: string): string | undefined {
  if (!name) return undefined;
  const n = normalizeName(name);
  return DICT.get(n) ?? DICT.get(stripSuffixes(n));
}

// مفتاح موحّد للفريق بين مزوّدي البيانات (المعرّفات تختلف بينهم):
// الاسم العربي إن وُجد (من الاسم الكامل أو المختصر)، وإلا الاسم الإنجليزي بعد التطبيع
export function teamKey(name: string, short?: string): string {
  return lookup(name) ?? lookup(short) ?? stripSuffixes(normalizeName(name));
}

export function teamName(name: string): string {
  if (!name) return name;
  const n = normalizeName(name);
  return DICT.get(n) ?? DICT.get(stripSuffixes(n)) ?? name;
}
