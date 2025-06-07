import requests
import sys, re
from bs4 import BeautifulSoup


pagenum = 1
baseURL = 'https://www.blu-ray.com/search/?quicksearch='
country = '&quicksearch_country=US'
keyword = '&quicksearch_keyword='
# searchTerm = 'sinners'
searchInput = sys.argv[1]
searchTerm = sys.argv[1].replace(" ","+")
searchSection = '&section=bluraymovies'

url = baseURL + str(pagenum) + country + keyword + searchTerm + searchSection
#print(url)
headers = { 'User-Agent':'Mozilla/5.0' }

r = requests.get(url, headers=headers)
soup = BeautifulSoup(r.text, 'html.parser')
searchresults=soup.find_all('div', style="display: inline-block")



movies = {}

for div in searchresults:
    if div.a:
        if div.a.img:
            movies[div.a['data-productid']]={"title": div.a['title'],"categoryID": div.a['data-categoryid'],"parentID": div.a['data-globalparentid'], "gproductID": div.a['data-globalproductid'], "productID": div.a['data-productid'], "productURL": div.a['href'], "productCover": div.a.img['src']}
        else:
            movies[div.a['data-productid']]={"title": div.a['title'],"categoryID": div.a['data-categoryid'],"parentID": div.a['data-globalparentid'], "gproductID": div.a['data-globalproductid'], "productID": div.a['data-productid'], "productURL": div.a['href'], "productCover": ""}



print("Results:")
if not movies:
    print("No results. Try fewer words or check your spelling.")
else:
    for movie in movies:
        if re.search(searchInput, movies[movie]['title'], re.IGNORECASE):
            print("   ID:", movies[movie]['productID'])
            print("Title:", movies[movie]['title'])
            print(" Page:", movies[movie]['productURL'])
            print("Cover:", movies[movie]['productCover'])
            print("")