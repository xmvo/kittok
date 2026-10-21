import { HttpError } from './http.mjs';

export const PrideFlags = [
	['rainbow', 'LGBTQ+ pride', ['#E40303', '#FF8C00', '#FFED00', '#008026', '#24408E', '#732982']],
	['lesbian', 'Lesbian', ['#D52D00', '#FF9A56', '#FFFFFF', '#D362A4', '#A30262']],
	['gay', 'Gay', ['#078D70', '#26CEAA', '#98E8C1', '#FFFFFF', '#7BADE2', '#5049CC', '#3D1A78']],
	['bisexual', 'Bisexual', ['#D60270', '#D60270', '#9B4F96', '#0038A8', '#0038A8']],
	['pansexual', 'Pansexual', ['#FF218C', '#FFD800', '#21B1FF']],
	['asexual', 'Asexual', ['#000000', '#A3A3A3', '#FFFFFF', '#800080']],
	['aromantic', 'Aromantic', ['#3DA542', '#A7D379', '#FFFFFF', '#A9A9A9', '#000000']],
	['demisexual', 'Demisexual', ['#FFFFFF', '#FFFFFF', '#6E0071', '#D2D2D2', '#D2D2D2']],
	['transgender', 'Transgender', ['#5BCEFA', '#F5A9B8', '#FFFFFF', '#F5A9B8', '#5BCEFA']],
	['nonbinary', 'Nonbinary', ['#FFF430', '#FFFFFF', '#9C59D1', '#2D2D2D']],
	['genderfluid', 'Genderfluid', ['#FF75A2', '#FFFFFF', '#BE18D6', '#000000', '#333EBD']],
	['genderqueer', 'Genderqueer', ['#B57EDC', '#FFFFFF', '#4A8123']],
	['intersex', 'Intersex', ['#FFD800']],
];

export const CommunityBadges = [
	['contributor', 'Contributor', '#25F4EE', 'M10 7 5 12l5 5m4-10 5 5-5 5'],
	['early_member', 'Early member', '#B794F6', 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z'],
	['supporter', 'Supporter', '#FE2C55', 'M20.8 5.6a5.4 5.4 0 0 0-7.6 0L12 6.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 22l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z'],
];

const Badge = ([Id, Label], Type) => ({ id: Id, label: Label, type: Type, icon: `/_kittok/badges/icon/${Id}.svg` });
export const BadgeCatalog = {
	pride: PrideFlags.map(Entry => Badge(Entry, 'pride')),
	community: CommunityBadges.map(Entry => Badge(Entry, 'community')),
};

export function PrideFlag(Value) {
	if (typeof Value !== 'string' || (Value !== '' && !PrideFlags.some(([Id]) => Id === Value))) throw new HttpError(400, 'InvalidPrideFlag');
	return Value;
}

export function UserBadges(Value) {
	if (!Array.isArray(Value) || Value.length > CommunityBadges.length || Value.some(Item => !CommunityBadges.some(([Id]) => Id === Item))) throw new HttpError(400, 'InvalidUserBadges');
	return CommunityBadges.map(([Id]) => Id).filter(Id => Value.includes(Id));
}

export function PublicBadges(User) {
	return [...BadgeCatalog.pride.filter(Badge => Badge.id === User.pride_flag), ...BadgeCatalog.community.filter(Badge => User.user_badges?.includes(Badge.id))];
}

export function BadgeSvg(Id) {
	const Flag = PrideFlags.find(Entry => Entry[0] === Id);
	const Award = CommunityBadges.find(Entry => Entry[0] === Id);
	if (!Flag && !Award) throw new HttpError(404, 'BadgeNotFound');
	const Content = Flag ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><title>${Flag[1]}</title>${Flag[2].map((Color, Index, All) => `<rect y="${20 * Index / All.length}" width="30" height="${20 / All.length + 0.01}" fill="${Color}"/>`).join('')}${Id === 'demisexual' ? '<path d="M0 0 14 10 0 20Z" fill="#000"/>' : Id === 'intersex' ? '<circle cx="15" cy="10" r="5" fill="none" stroke="#7902AA" stroke-width="2"/>' : ''}</svg>`
		: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>${Award[1]}</title><path d="${Award[3]}" fill="${Id === 'contributor' ? 'none' : Award[2]}" stroke="${Award[2]}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
	return Content;
}
