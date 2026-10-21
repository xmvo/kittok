import { HttpError } from './http.mjs';

export const Categories = [
	[119, 'Singing & Dancing', ['dance', 'dancing', 'dancer', 'dancechallenge', 'choreo', 'choreography', 'sing', 'singing', 'singer', 'cover', 'vocals', 'music', 'song']],
	[104, 'Comedy', ['funny', 'comedy', 'meme', 'memes', 'humor', 'joke', 'jokes', 'prank', 'skit', 'lol', 'lmao']],
	[112, 'Sports', ['sports', 'sport', 'football', 'soccer', 'basketball', 'nba', 'nfl', 'baseball', 'tennis', 'skate', 'skateboarding', 'boxing', 'mma', 'golf', 'hockey', 'f1']],
	[100, 'Anime & Comics', ['anime', 'manga', 'otaku', 'cosplay', 'comics', 'webtoon', 'naruto', 'onepiece']],
	[107, 'Relationship', ['relationship', 'couple', 'couples', 'love', 'boyfriend', 'girlfriend', 'dating', 'crush']],
	[101, 'Shows', ['tvshow', 'show', 'series', 'movie', 'movies', 'film', 'netflix', 'celebrity']],
	[110, 'Lipsync', ['lipsync', 'lipsyncing', 'lipsyncchallenge', 'pov']],
	[105, 'Daily Life', ['dailylife', 'dayinmylife', 'vlog', 'routine', 'morningroutine', 'life', 'storytime', 'grwm']],
	[102, 'Beauty Care', ['makeup', 'beauty', 'skincare', 'hair', 'hairstyle', 'nails', 'cosmetics', 'makeuptutorial']],
	[103, 'Games', ['gaming', 'game', 'games', 'gamer', 'minecraft', 'fortnite', 'roblox', 'valorant', 'gta', 'pokemon', 'videogames', 'twitch', 'xbox', 'playstation', 'nintendo']],
	[114, 'Society', ['news', 'society', 'politics', 'history', 'culture', 'community', 'activism']],
	[109, 'Outfit', ['outfit', 'outfits', 'ootd', 'fashion', 'style', 'fit', 'fitcheck', 'streetwear', 'thrift']],
	[115, 'Cars', ['car', 'cars', 'carsoftiktok', 'jdm', 'supercar', 'drift', 'racing', 'motorcycle', 'bike']],
	[111, 'Food', ['food', 'foodie', 'recipe', 'recipes', 'cooking', 'baking', 'foodtok', 'mukbang', 'chef', 'dinner', 'lunch', 'breakfast']],
	[113, 'Animals', ['cat', 'cats', 'dog', 'dogs', 'puppy', 'kitten', 'pet', 'pets', 'animals', 'animal', 'catsoftiktok', 'dogsoftiktok', 'bird', 'wildlife']],
	[106, 'Family', ['family', 'mom', 'dad', 'parenting', 'baby', 'kids', 'siblings', 'momlife']],
	[108, 'Drama', ['drama', 'acting', 'shortfilm', 'story', 'roleplay']],
	[117, 'Fitness & Health', ['fitness', 'gym', 'workout', 'health', 'yoga', 'running', 'gymtok', 'bodybuilding', 'wellness']],
	[116, 'Education', ['education', 'learn', 'learning', 'study', 'school', 'science', 'math', 'facts', 'tutorial', 'howto', 'learnontiktok', 'edutok']],
	[118, 'Technology', ['tech', 'technology', 'coding', 'programming', 'ai', 'computer', 'pc', 'iphone', 'android', 'gadget', 'gadgets']],
];
const Types = new Set(Categories.map(([Type]) => Type));
const Words = new Map(Categories.flatMap(([Type, , List]) => List.map(Word => [Word, Type])));

export function Category(Value) {
	if (Value === undefined || Value === null || Value === '') return null;
	const Type = Number(Value);
	if (Type !== 0 && !Types.has(Type)) throw new HttpError(400, 'InvalidCategory');
	return Type;
}

export function GuessCategory(Description) {
	const Text = String(Description ?? '').toLowerCase();
	const Scores = new Map();
	for (const Match of Text.matchAll(/(#?)([\p{L}\p{N}_]+)/gu)) {
		const Type = Words.get(Match[2]);
		if (Type) Scores.set(Type, (Scores.get(Type) ?? 0) + (Match[1] ? 3 : 1));
	}
	let Best = 0, Score = 0;
	for (const [Type, Points] of Scores) if (Points > Score) { Best = Type; Score = Points; }
	return Best;
}

export async function BackfillCategories(Pool) {
	const Rows = (await Pool.query('SELECT id, description FROM videos WHERE category = -1')).rows;
	for (const Row of Rows) await Pool.query('UPDATE videos SET category = $2 WHERE id = $1 AND category = -1', [Row.id, GuessCategory(Row.description)]);
}
