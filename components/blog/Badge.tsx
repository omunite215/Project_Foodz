const Badge = ({ type }: { type: "Healthy" | "Food" | "Family" }) => {
	const style =
		type === "Food"
			? "bg-[#D3F9D5] text-primaryGreen"
			: type === "Family"
				? "bg-[#F1F7FC] text-[#106AAB]"
				: "bg-[#FCF1F1] text-[#EA8484]";
	return (
		<span
			className={`inline-flex items-center justify-center px-2 py-1 text-xs leading-none rounded ${style}`}
		>
			{type}
		</span>
	);
};

export default Badge;
