import { Form } from "../common";
import Link from "next/link";
import Image from "next/image";
const Now = () => {
	return (
		<section className="w-full flexCenter flex-col md:py-14 sm:py-20 py-10 sm:gap-[6.5rem] gap-8 padding-x">
			<div className="flexCenter flex-col gap-3">
				<h2 className="component-title-text">
					Get the Best Taste&nbsp;
					<span className="component-title-highlight-text">Now!</span>
				</h2>
				<p className="component-sub-title-text">
					Best cooks and best delivery guys all at your service. Hot tasty food
					will reach you in 60 minutes.
				</p>
			</div>
			<div className="flex flex-1 justify-between items-center md:flex-row flex-col w-full">
				<Form />
				<Image
					src="/Home/FormSection/deliveryBoy.svg"
					width={451}
					height={396}
					alt="StarChef"
					className="sm:block hidden max-w-[33.75rem] max-h-[26.9575rem] min-w-[26.875rem] min-h-[21.4375rem]"
				/>
			</div>
		</section>
	);
};

export default Now;
