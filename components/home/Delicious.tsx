import { DeliciousContent } from "@/constants";
import { DeliciousCard } from "../common";

const Delicious = () => {
	return (
		<section className="w-full flexCenter flex-col sm:gap-[6.69rem] gap-8 sm:py-14 py-10 padding-x">
			<h1 className="component-title-text">
				How we keep your meal&nbsp;
				<span className="component-title-highlight-text">Delicious</span>
			</h1>
			<div className=" w-full flexBetween md:flex-row flex-col sm:gap-0 gap-8">
				{DeliciousContent.map((card) => (
					<div key={card.title}>
						<DeliciousCard
							imageSrc={card.imageSrc}
							title={card.title}
							description={card.description}
						/>
					</div>
				))}
			</div>
		</section>
	);
};

export default Delicious;
