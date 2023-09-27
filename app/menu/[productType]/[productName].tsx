import React from 'react'
import ProductPage from '@/components/menu/ProductPage'
import { koreanMenu, VietnameseMenu, ThaiMenu } from '@/constants';
import { useRouter } from 'next/router';

interface ProductIdProps{
  wholeMenu: [{
  id: string;
  imageSrc: string;
  title: string;
  price: number;
  show: boolean;
  linkTitle: string;
  content?: string[];
  }];
  targetId: string;
}
const wholeMenu = koreanMenu.concat(VietnameseMenu.concat(ThaiMenu));
function getProductById({wholeMenu, targetId}:ProductIdProps) {
  return wholeMenu.find(product => product.id === targetId);
}


const ProductName = () => {
const router = useRouter(); 

let productToFind = router.query.productName;

  return (
    <>
    </>
  )
}

export default ProductName