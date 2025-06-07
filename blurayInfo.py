#!/usr/bin/env python3

import requests
import sys, re
from bs4 import BeautifulSoup



baseURL = 'https://www.blu-ray.com/movies/'
titleInput = sys.argv[1]

titleClean = titleInput.split(' (')[0].replace(' ', '-').replace('+','and')
titleID = sys.argv[2]

titleURL = baseURL + titleClean + '-Blu-ray/' + str(titleID) + '/'
headers = { 'User-Agent':'Mozilla/5.0' }

r = requests.get(titleURL, headers=headers)
soup = BeautifulSoup(r.text, 'html.parser')


titleInfo = soup.find_all('span', {'class': 'subheading grey'})[0].text.split(' | ')

table = soup.find_all('div', id="bluray_rating")[0].table
td = table.find_all('td')

if td[0].text == '3D':
	ratings = {td[0].text: td[2].text, td[3].text: td[5].text, td[6].text: td[8].text, td[9].text: td[11].text, td[12].text: td[14].text}
elif td[0].text =='Video 4k':
	ratings = {td[0].text: td[2].text, td[3].text: td[5].text, td[6].text: td[8].text, td[9].text: td[11].text}
else:
	ratings = {td[0].text: td[2].text, td[3].text: td[5].text, td[6].text: td[8].text}


if len(titleInfo) == 4:
	titleInfo.insert(0, '')


titleInfo.insert(5, soup.find('img', id="frontimage_overlay")['src'])
titleInfo.insert(6, soup.find_all('a', id="movie_buylink")[0]['href'])
titleInfo.insert(7, soup.find_all('a', id="imdb_icon")[0]['href'])
titleInfo.insert(8, soup.find_all('div', id="videotrailer_container")[0].source['src'])
titleInfo.insert(9,titleInput)


class release:
	def __init__(self,dictionary):
		self.studio = dictionary[0]
		self.year = dictionary[1]
		self.length = dictionary[2]
		self.rating = dictionary[3]
		self.date = dictionary[4]
		self.coverArt = dictionary[5]
		self.amazon = dictionary[6]
		self.imdbURL = dictionary[7]
		self.imdbID = dictionary[7].split('/')[4]
		self.trailer = dictionary[8]
		self.title = dictionary[9]
	def __str__(self):
		return f"{self.title}\n{self.studio} {self.year}\nDuration: {self.length}\nRated: {self.rating}\nReleased: {self.date}\nCover Art: {self.coverArt}\nAmazon Link: {self.amazon}\nIMDB Link: {self.imdbURL}\nIMDB ID: {self.imdbID}\nTrailer: {self.trailer}"
		


movieRelease = release(titleInfo)

print(movieRelease)
print('\n',ratings)
		
		