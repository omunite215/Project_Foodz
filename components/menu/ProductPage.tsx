import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/common";
import { flavors } from "@/constants";

interface ProductPageProps {
	title?: string;
	imgSrc?: string;
	price?: number;
	description?: string;
}

const ProductPage = ({
	title,
	imgSrc,
	price,
	description,
}: ProductPageProps) => {
	return (
		<section className="padding-x">
			<div className="flexStart flex-col py-4">
				<Link
					href="/menu"
					className="flexStart gap-3 px-5 py-[0.62rem] border border-neutralLineWhite rounded-lg hover:bg-neutralWhite"
				>
					<Image
						src="/Icons/backArrow.svg"
						alt="back-arrow"
						width={0}
						height={0}
						className="w-6 h-6 object-contain"
					/>
					<span className=" font-poppins text-base text-paraTextColor font-medium">
						Go back
					</span>
				</Link>
			</div>
			<div className="w-full flexCenter sm:flex-row flex-col pt-4 pb-12 md:gap-[5.38rem] sm:gap-12 gap-5">
				<Image
					src={imgSrc ? imgSrc : "/noimage.png"}
					alt="product-image"
					width={0}
					height={0}
					className="md:w-[26rem] sm:w-[24.9375rem] w-[20.0625rem] md:h-[26rem] sm:h-[24.9375rem] h-[20.0625rem]"
				/>
				<div className=" flexStart flex-col md:gap-8 gap-6 max-w-[41.25rem]">
					<div>
						<h4 className=" font-poppins text-base text-paraTextColor font-normal">
							Best seller
						</h4>
						<div className="flex justify-start sm:items-center items-start sm:flex-row flex-col sm:gap-6 gap-3">
							<h1 className=" font-alice md:text-5xl text-[2rem] md:tracking-normal tracking-wider font-normal capitalize text-textBlack">
								{title}
							</h1>
							<div className="flexCenter gap-[0.62rem] px-2 py-1 border border-primaryGreen rounded-md">
								<Image
									src="/Icons/fire.svg"
									alt="fire"
									width={24}
									height={24}
								/>
								<h3 className="special-offers-card-cooking-time">02:21:11</h3>
							</div>
						</div>
					</div>
					<div>
						<h1 className=" font-alice text-[2.5rem] -tracking-[0.0125rem] text-primaryGreen">
							${price}
						</h1>
					</div>
					<div className="w-full flexBetween pb-5 border-b-2 border-neutralLineWhite">
						<div className="flex justify-start items-center gap-3">
							<Image
								src="/Icons/stars.svg"
								height={24}
								width={136}
								alt="stars"
							/>
							<p className=" font-poppins text-paraTextColor font-semibold text-base">
								214 Reviews
							</p>
						</div>
						<p className=" font-poppins text-textNeutralBlack text-base font-normal">
							View all
						</p>
					</div>
					<div className="space-y-4">
						<article className="space-y-1">
							<h5 className=" font-poppins text-base text-paraTextColor">
								Description:
							</h5>
							<p className="max-w-[41.25rem] min-w-full self-stretch font-poppins text-sm font-normal leading-normal text-textNeutralBlack">
								{description}
							</p>
						</article>
						<article className="space-y-1 mt-4">
							<h5 className=" font-poppins text-base text-paraTextColor">
								Adjust the flavor:
							</h5>
							<ul className="grid sm:grid-cols-3 grid-cols-2 list-disc gap-x-6 ml-5">
								{flavors.map((flavor) => (
									<li
										key={flavor}
										className=" py-1 px-3 text-textNeutralBlack text-xs leading-3"
									>
										{flavor}
									</li>
								))}
							</ul>
						</article>
						<article className="space-y-2 mt-4">
							<h5 className="font-poppins text-base text-paraTextColor">
								Note:
							</h5>
							<textarea
								name="note"
								className="form-input"
								cols={10}
								rows={5}
								placeholder="More spicy, more sauce, ..."
							/>
						</article>
					</div>
					<Link href="/checkout">
						<Button />
					</Link>
				</div>
			</div>
		</section>
	);
};

export default ProductPage;
