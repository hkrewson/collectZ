<?php
    
$searchtitle = ""
$url = "https://www.blu-ray.com/search/?quicksearch=1&quicksearch_country=US&quicksearch_keyword=" . $searchtitle . "&section=bluraymovies";

$options = [
    "http" => [
        "header" => 'User-Agent: Mozilla/5.0'
    ]
];

$context = stream_context_create($options);
$html = file_get_contents($url, false, $context);


//echo $html;

// parse the HTML content using php-html-parser
    $dom = new DOMDocument();
    @$dom->loadHTML($html);
    $xpath = new DOMXPath($dom);
    
    #("//*[contains(@div, 'display: inline-block')]")
    # query = "//div[@style='display: inline-block']";
    #$divs = $xpath->query(//div[@style="display: inline-block"]');
    $atags = $xpath->query("//div[@style='display: inline-block']//a");
    $imgs = $xpath->query("//div[@style='display: inline-block']//a//img");
    $i = 0;
    #echo $ares[0]->getAttribute("title")
//  foreach ($ares as $div) {
//      echo $div->getAttribute("title");
//  }
    
/* 
    [productid] => Array
    (
    [Blu-Ray.com Product ID] => productid
    [Blu-Ray.com Global ID] => globalid
    [Blu-Ray.com URL] => href
    [Title] => Movie Title (YYYY)
    )
    */
foreach ($atags as $atag) {
    $productid = $atag->getAttribute("data-productid");
    $globalid = $atag->getAttribute("data-globalproductid");
    $href = $atag->getAttribute("href");
    $title = $atag->getAttribute("title");
    $img = $xpath->query(".//img", $atag);
    $poster = '';
    if (!empty($img->item(0))) {
        $poster = $img->item(0)->getAttribute("src");
    };
    $movies[$productid] = ["Blu-Ray.com Product ID" => $productid,"Blu-Ray.com Global ID" => $globalid, "Blu-Ray.com URL" => $href, "Title" => $title, "Poster" => $poster];

        }

print_r($movies)
?>
